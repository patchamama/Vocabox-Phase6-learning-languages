/**
 * AudioReviewPanel — generates a review MP3 from words that have both
 * audio_url and audio_url_translation stored. Uses a backend WebSocket
 * to stream progress while ffmpeg concatenates the clips.
 *
 * order options: word_first | translation_first | both
 * TTS option: fill missing clips + optionally include TTS-only words
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api, { audioReviewApi } from '../api/client'
import { playAudio, stopCurrent } from '../utils/audioManager'
import { useSettingsStore } from '../stores/settingsStore'
import SubtitlePlayer from './SubtitlePlayer'
import type { UserWord } from '../types'

interface AudioFile {
  filename: string
  size_kb: number
  created_at: number
  duration_seconds?: number | null
  has_srt: boolean
  srt_filename: string | null
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

interface JobState {
  status: string
  progress: number
  total: number
  filename: string | null
  srt_filename: string | null
  error: string | null
}

interface Props {
  filteredWords: UserWord[]
  onClose: () => void
}

const GAP_OPTIONS = [0.5, 1, 2, 3, 5]

export default function AudioReviewPanel({ filteredWords, onClose }: Props) {
  const { t } = useTranslation()
  const { useTtsInAudioReview, ttsVoices, ttsRate, audioReviewExtraLangs, leoExtraLangs, ollamaTranslationModel, completeWithTts, setCompleteWithTts } = useSettingsStore()

  const [order, setOrder] = useState<'word_first' | 'translation_first' | 'both'>('word_first')
  const [gapSeconds, setGapSeconds] = useState(2)
  const [beep, setBeep] = useState(true)
  const [includeTtsWords, setIncludeTtsWords] = useState(false)
  // Local copy of extra languages — initialized from store, editable per-generation
  const [localExtraLangs, setLocalExtraLangs] = useState<string[]>(
    audioReviewExtraLangs ? leoExtraLangs : [],
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [jobState, setJobState] = useState<JobState | null>(null)
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingPlay, setLoadingPlay] = useState<string | null>(null)
  const [playingFile, setPlayingFile] = useState<string | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [playProgress, setPlayProgress] = useState<{ current: number; total: number } | null>(null)
  // Cache: filename → { audio, url } — avoids re-downloading on pause/resume
  const audioCache = useRef<Map<string, { audio: HTMLAudioElement; url: string }>>(new Map())
  // Saved playback position per file (survives switching to another file)
  const pausedAt = useRef<Map<string, number>>(new Map())
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Subtitle player state
  const [subtitlePlayer, setSubtitlePlayer] = useState<{
    audioBlob: Blob
    srtText: string
    filename: string
  } | null>(null)

  const eligible = filteredWords.filter(
    (uw) => uw.word.audio_url && uw.word.audio_url_translation,
  )
  const ttsEligible = useTtsInAudioReview
    ? filteredWords.filter(
        (uw) =>
          !uw.word.audio_url || !uw.word.audio_url_translation,
      ).length
    : 0

  useEffect(() => {
    loadAudioFiles()
    return () => {
      wsRef.current?.close()
      stopCurrent()
      stopTracking()
      // Release all cached blob URLs
      audioCache.current.forEach(({ audio, url }) => {
        audio.pause()
        URL.revokeObjectURL(url)
      })
      audioCache.current.clear()
    }
  }, [])

  const stopTracking = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current)
      progressIntervalRef.current = null
    }
  }

  const startTracking = (audio: HTMLAudioElement) => {
    stopTracking()
    setPlayProgress({ current: audio.currentTime, total: audio.duration })
    progressIntervalRef.current = setInterval(() => {
      setPlayProgress({ current: audio.currentTime, total: audio.duration })
    }, 100)
  }

  // Pause the currently playing audio and save its position
  const pauseCurrent = () => {
    const entry = playingFile ? audioCache.current.get(playingFile) : null
    if (entry) {
      pausedAt.current.set(playingFile!, entry.audio.currentTime)
      entry.audio.pause()
    }
    stopCurrent()
    stopTracking()
    setIsPaused(true)
  }

  const loadAudioFiles = async () => {
    try {
      const res = await audioReviewApi.list()
      setAudioFiles(res.data)
    } catch {}
  }

  const handleGenerate = async () => {
    if (!eligible.length && !(useTtsInAudioReview && includeTtsWords)) return
    setIsGenerating(true)
    const totalEligible = eligible.length + (useTtsInAudioReview && includeTtsWords ? ttsEligible : 0)
    setJobState({ status: 'pending', progress: 0, total: totalEligible, filename: null, srt_filename: null, error: null })

    try {
      const wordIds = filteredWords.map((uw) => uw.word.id)
      const res = await audioReviewApi.generate(
        wordIds,
        order,
        gapSeconds,
        beep,
        useTtsInAudioReview,
        includeTtsWords,
        ttsVoices,
        ttsRate,
        localExtraLangs,
        localExtraLangs.length > 0 ? ollamaTranslationModel : '',
        completeWithTts,
      )
      const jobId: string = res.data.job_id

      const token = localStorage.getItem('token') ?? ''
      const baseUrl = ((api.defaults.baseURL as string) ?? '').replace(/\/$/, '')
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${proto}://${window.location.host}${baseUrl}/audio-review/ws/${jobId}?token=${encodeURIComponent(token)}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        const data: JobState = JSON.parse(ev.data as string)
        setJobState(data)
        if (data.status === 'done' || data.status === 'error') {
          ws.close()
          setIsGenerating(false)
          if (data.status === 'done') loadAudioFiles()
        }
      }
      ws.onerror = () => {
        setJobState((s) => (s ? { ...s, status: 'error', error: 'WebSocket error' } : null))
        setIsGenerating(false)
      }
      ws.onclose = (ev) => {
        if (ev.code !== 1000 && ev.code !== 1005) {
          setJobState((s) =>
            s && s.status !== 'done' && s.status !== 'error'
              ? { ...s, status: 'error', error: `WebSocket closed (${ev.code})` }
              : s,
          )
          setIsGenerating(false)
        }
      }
    } catch {
      setJobState({ status: 'error', progress: 0, total: 0, filename: null, srt_filename: null, error: 'Request failed' })
      setIsGenerating(false)
    }
  }

  const handlePlay = async (filename: string) => {
    // Toggle pause/resume for the currently playing file
    if (playingFile === filename) {
      const entry = audioCache.current.get(filename)
      if (entry && !entry.audio.paused) {
        // Currently playing → pause and save position
        pausedAt.current.set(filename, entry.audio.currentTime)
        entry.audio.pause()
        stopCurrent()
        stopTracking()
        setIsPaused(true)
      } else if (entry && entry.audio.paused) {
        // Currently paused → resume from saved position
        const saved = pausedAt.current.get(filename) ?? 0
        entry.audio.currentTime = saved
        playAudio(entry.audio)
        setIsPaused(false)
        startTracking(entry.audio)
      }
      return
    }

    // Switching to a different file — pause current without clearing state
    if (playingFile) {
      const cur = audioCache.current.get(playingFile)
      if (cur) {
        pausedAt.current.set(playingFile, cur.audio.currentTime)
        cur.audio.pause()
        stopCurrent()
        stopTracking()
      }
    }

    // Check if this file is already cached
    const cached = audioCache.current.get(filename)
    if (cached) {
      setPlayingFile(filename)
      setIsPaused(false)
      const saved = pausedAt.current.get(filename) ?? 0
      cached.audio.currentTime = saved
      playAudio(cached.audio)
      startTracking(cached.audio)
      return
    }

    // Download and create new Audio object
    setLoadingPlay(filename)
    try {
      const res = await audioReviewApi.getFile(filename)
      const url = URL.createObjectURL(res.data as Blob)
      const audio = new Audio(url)

      audio.onended = () => {
        pausedAt.current.delete(filename)
        stopTracking()
        setPlayingFile(null)
        setIsPaused(false)
        setPlayProgress(null)
      }

      audioCache.current.set(filename, { audio, url })
      setPlayingFile(filename)
      setIsPaused(false)

      const resume = () => {
        playAudio(audio)
        startTracking(audio)
      }
      if (audio.readyState >= 1) resume()
      else audio.onloadedmetadata = resume
    } finally {
      setLoadingPlay(null)
    }
  }

  const handleScrub = (filename: string, e: React.MouseEvent<HTMLDivElement>) => {
    const entry = audioCache.current.get(filename)
    if (!entry) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const newTime = pct * entry.audio.duration
    entry.audio.currentTime = newTime
    pausedAt.current.set(filename, newTime)
    setPlayProgress({ current: newTime, total: entry.audio.duration })
  }

  const handleOpenSubtitles = async (af: AudioFile) => {
    if (!af.srt_filename) return
    try {
      const [audioRes, srtRes] = await Promise.all([
        audioReviewApi.getFile(af.filename),
        audioReviewApi.getSrt(af.srt_filename),
      ])
      setSubtitlePlayer({
        audioBlob: audioRes.data as Blob,
        srtText: srtRes.data as string,
        filename: af.filename,
      })
    } catch {}
  }

  const handleDownload = async (filename: string) => {
    const res = await audioReviewApi.getFile(filename)
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleDownloadSrt = async (srtFilename: string) => {
    const res = await audioReviewApi.getSrt(srtFilename)
    const blob = new Blob([res.data as string], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = srtFilename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleDelete = async (filename: string) => {
    try {
      await audioReviewApi.deleteFile(filename)
      // Clean up cache and saved position
      const entry = audioCache.current.get(filename)
      if (entry) { entry.audio.pause(); URL.revokeObjectURL(entry.url) }
      audioCache.current.delete(filename)
      pausedAt.current.delete(filename)
      if (playingFile === filename) { stopTracking(); setPlayingFile(null); setPlayProgress(null); setIsPaused(false) }
      setAudioFiles((prev) => prev.filter((f) => f.filename !== filename))
      setSelected((prev) => { const n = new Set(prev); n.delete(filename); return n })
    } catch {}
  }

  const handleDeleteSelected = async () => {
    await Promise.allSettled([...selected].map((f) => audioReviewApi.deleteFile(f)))
    setAudioFiles((prev) => prev.filter((f) => !selected.has(f.filename)))
    setSelected(new Set())
  }

  const toggleSelect = (filename: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(filename) ? n.delete(filename) : n.add(filename)
      return n
    })
  }

  const progressPct = jobState && jobState.total > 0
    ? Math.round((jobState.progress / jobState.total) * 100)
    : 0

  return (
    <>
      <div className="card space-y-4 animate-slide-up border-blue-500/30">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">
            🎧 {t('audioReview.title')}
          </p>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors px-1">✕</button>
        </div>

        {/* Options */}
        {!isGenerating && (
          <div className="space-y-3">
            {/* Order — now 3 options */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-slate-400 w-20 shrink-0">{t('audioReview.orderLabel')}</span>
              <div className="flex gap-1 flex-wrap">
                {(['word_first', 'translation_first', 'both'] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOrder(o)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      order === o
                        ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                        : 'border-slate-600 bg-slate-700 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {t(`audioReview.${o}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Gap */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-slate-400 w-20 shrink-0">{t('audioReview.gapLabel')}</span>
              <div className="flex gap-1 flex-wrap">
                {GAP_OPTIONS.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGapSeconds(g)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      gapSeconds === g
                        ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                        : 'border-slate-600 bg-slate-700 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {g}s
                  </button>
                ))}
              </div>
            </div>

            {/* Beep */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 w-20 shrink-0">{t('audioReview.beepLabel')}</span>
              <button
                onClick={() => setBeep((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors ${beep ? 'bg-blue-600' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${beep ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>

            {/* TTS section — complete missing text + include words without MP3 */}
            {useTtsInAudioReview && (
              <div className="space-y-2 pt-1 border-t border-slate-700/40">
                {/* Complete missing text with TTS */}
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-xs text-slate-300">{t('audioReview.completeWithTts')}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{t('audioReview.completeWithTtsDesc')}</p>
                  </div>
                  <button
                    onClick={() => setCompleteWithTts(!completeWithTts)}
                    className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${completeWithTts ? 'bg-blue-600' : 'bg-slate-600'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${completeWithTts ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>

                {/* Include words without MP3 */}
                {ttsEligible > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 flex-1">
                      {t('audioReview.includeTtsWords', { count: ttsEligible })}
                    </span>
                    <button
                      onClick={() => setIncludeTtsWords((v) => !v)}
                      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${includeTtsWords ? 'bg-blue-600' : 'bg-slate-600'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${includeTtsWords ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Extra languages */}
            <div className="space-y-1.5 pt-1 border-t border-slate-700/40">
              <p className="text-xs text-slate-400">{t('audioReview.extraLangsLabel')}</p>
              {leoExtraLangs.length === 0 ? (
                <p className="text-xs text-slate-600 italic">{t('audioReview.extraLangsNone')}</p>
              ) : (
                <div className="flex gap-1.5 flex-wrap">
                  {leoExtraLangs.map((lang) => {
                    const active = localExtraLangs.includes(lang)
                    return (
                      <button
                        key={lang}
                        onClick={() =>
                          setLocalExtraLangs((prev) =>
                            active ? prev.filter((l) => l !== lang) : [...prev, lang],
                          )
                        }
                        className={`text-xs px-2.5 py-1 rounded-lg border font-mono uppercase transition-colors ${
                          active
                            ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                            : 'border-slate-600 bg-slate-700 text-slate-500 hover:border-slate-500'
                        }`}
                      >
                        {lang}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Eligible count + generate */}
            <div className="flex items-center gap-3 pt-1 border-t border-slate-700/60">
              <span className="text-xs text-slate-500 flex-1">
                {eligible.length > 0
                  ? t('audioReview.eligibleWords', { count: eligible.length })
                  : t('audioReview.noEligibleWords')}
                {useTtsInAudioReview && includeTtsWords && ttsEligible > 0 && (
                  <span className="text-slate-600 ml-1">+ {ttsEligible} TTS</span>
                )}
              </span>
              <button
                onClick={handleGenerate}
                disabled={eligible.length === 0 && !(useTtsInAudioReview && includeTtsWords && ttsEligible > 0)}
                className="btn-primary py-2 px-4 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('audioReview.generateBtn')}
              </button>
            </div>
          </div>
        )}

        {/* Progress */}
        {jobState && (jobState.status === 'running' || jobState.status === 'pending') && (
          <div className="space-y-2">
            <p className="text-sm text-slate-300">
              {t('audioReview.generating', { progress: jobState.progress, total: jobState.total })}
            </p>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* Error */}
        {jobState?.status === 'error' && (
          <p className="text-sm text-red-400">{t('audioReview.errorGenerate')}</p>
        )}

        {/* Done */}
        {jobState?.status === 'done' && jobState.filename && (
          <div className="flex items-center gap-3 p-3 bg-green-900/20 border border-green-500/30 rounded-xl flex-wrap">
            <span className="text-green-400 text-sm flex-1">✓ {t('audioReview.done')}</span>
            <button
              onClick={() => handlePlay(jobState.filename!)}
              disabled={loadingPlay === jobState.filename}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              {loadingPlay === jobState.filename ? '…' : '▶'} {t('audioReview.play')}
            </button>
            <button
              onClick={() => handleDownload(jobState.filename!)}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              ↓ {t('audioReview.download')}
            </button>
            {jobState.srt_filename && (
              <button
                onClick={() => handleDownloadSrt(jobState.srt_filename!)}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                ↓ SRT
              </button>
            )}
          </div>
        )}

        {/* File list */}
        {audioFiles.length > 0 && (
          <div className="space-y-2 border-t border-slate-700/60 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500 uppercase tracking-widest">{t('audioReview.previousAudios')}</p>
              {selected.size > 0 && (
                <button onClick={handleDeleteSelected} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                  {t('audioReview.deleteSelected', { count: selected.size })}
                </button>
              )}
            </div>

            <div className="space-y-0.5 max-h-52 overflow-y-auto">
              {audioFiles.map((af) => (
                <div key={af.filename} className="flex flex-col gap-0.5 py-1.5 px-2 hover:bg-slate-700/30 rounded-lg group">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(af.filename)}
                      onChange={() => toggleSelect(af.filename)}
                      className="w-3.5 h-3.5 accent-blue-500 shrink-0 cursor-pointer"
                    />
                    <span className="text-xs text-slate-400 flex-1 truncate font-mono" title={af.filename}>
                      {af.filename}
                    </span>
                    {/* Progress or static duration */}
                    {playingFile === af.filename && playProgress ? (
                      <span className={`text-xs shrink-0 tabular-nums ${isPaused ? 'text-slate-400' : 'text-blue-400'}`}>
                        {formatDuration(playProgress.current)}/{formatDuration(playProgress.total)}
                      </span>
                    ) : af.duration_seconds != null ? (
                      <span className="text-xs text-slate-500 shrink-0">{formatDuration(af.duration_seconds)}</span>
                    ) : null}
                    <span className="text-xs text-slate-600 shrink-0">{af.size_kb} KB</span>

                    {/* Play/pause/resume */}
                    <button
                      onClick={() => handlePlay(af.filename)}
                      disabled={loadingPlay === af.filename}
                      title={
                        playingFile === af.filename && !isPaused
                          ? t('audioReview.pause')
                          : t('audioReview.play')
                      }
                      className={`transition-colors text-xs px-1 opacity-0 group-hover:opacity-100 ${
                        playingFile === af.filename
                          ? 'text-blue-400 hover:text-yellow-400 !opacity-100'
                          : 'text-slate-500 hover:text-blue-400'
                      }`}
                    >
                      {loadingPlay === af.filename
                        ? '…'
                        : playingFile === af.filename && !isPaused
                          ? '⏸'
                          : playingFile === af.filename && isPaused
                            ? '▶'
                            : '▶'}
                    </button>

                    {/* View subtitles */}
                    {af.has_srt && (
                      <button
                        onClick={() => handleOpenSubtitles(af)}
                        title={t('audioReview.viewWords')}
                        className="text-slate-500 hover:text-purple-400 transition-colors text-xs px-1 opacity-0 group-hover:opacity-100"
                      >
                        📖
                      </button>
                    )}

                    {/* Download MP3 */}
                    <button
                      onClick={() => handleDownload(af.filename)}
                      title={t('audioReview.download')}
                      className="text-slate-500 hover:text-green-400 transition-colors text-xs px-1 opacity-0 group-hover:opacity-100"
                    >
                      ↓
                    </button>

                    {/* Download SRT */}
                    {af.has_srt && af.srt_filename && (
                      <button
                        onClick={() => handleDownloadSrt(af.srt_filename!)}
                        title={t('audioReview.downloadSrt')}
                        className="text-slate-500 hover:text-cyan-400 transition-colors text-xs px-1 opacity-0 group-hover:opacity-100"
                      >
                        ↓srt
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(af.filename)}
                      title={t('common.delete')}
                      className="text-slate-500 hover:text-red-400 transition-colors text-xs px-1 opacity-0 group-hover:opacity-100"
                    >
                      🗑
                    </button>
                  </div>

                  {/* Progress bar — clickable for scrubbing */}
                  {playingFile === af.filename && playProgress && playProgress.total > 0 && (
                    <div
                      className="w-full bg-slate-700 rounded-full h-2 mt-0.5 cursor-pointer group/bar relative"
                      onClick={(e) => handleScrub(af.filename, e)}
                    >
                      <div
                        className={`h-2 rounded-full transition-none ${isPaused ? 'bg-slate-500' : 'bg-blue-500'}`}
                        style={{ width: `${(playProgress.current / playProgress.total) * 100}%` }}
                      />
                      {/* Scrub handle */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none"
                        style={{ left: `calc(${(playProgress.current / playProgress.total) * 100}% - 6px)` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Subtitle player modal */}
      {subtitlePlayer && (
        <SubtitlePlayer
          audioBlob={subtitlePlayer.audioBlob}
          srtText={subtitlePlayer.srtText}
          filename={subtitlePlayer.filename}
          onClose={() => setSubtitlePlayer(null)}
        />
      )}
    </>
  )
}
