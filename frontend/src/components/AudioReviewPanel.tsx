/**
 * AudioReviewPanel — generates a review MP3 from words that have both
 * audio_url and audio_url_translation stored. Uses a backend WebSocket
 * to stream progress while ffmpeg concatenates the clips.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api, { audioReviewApi } from '../api/client'
import { playAudio, stopCurrent } from '../utils/audioManager'
import type { UserWord } from '../types'

interface AudioFile {
  filename: string
  size_kb: number
  created_at: number
  duration_seconds?: number | null
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
  error: string | null
}

interface Props {
  filteredWords: UserWord[]
  onClose: () => void
}

const GAP_OPTIONS = [0.5, 1, 2, 3, 5]

export default function AudioReviewPanel({ filteredWords, onClose }: Props) {
  const { t } = useTranslation()
  const [order, setOrder] = useState<'word_first' | 'translation_first'>('word_first')
  const [gapSeconds, setGapSeconds] = useState(2)
  const [beep, setBeep] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [jobState, setJobState] = useState<JobState | null>(null)
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingPlay, setLoadingPlay] = useState<string | null>(null)
  const [playingFile, setPlayingFile] = useState<string | null>(null)
  const [playProgress, setPlayProgress] = useState<{ current: number; total: number } | null>(null)
  const playingAudioRef = useRef<HTMLAudioElement | null>(null)
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const eligible = filteredWords.filter(
    (uw) => uw.word.audio_url && uw.word.audio_url_translation,
  )

  const stopProgress = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current)
      progressIntervalRef.current = null
    }
    setPlayingFile(null)
    setPlayProgress(null)
    playingAudioRef.current = null
  }

  useEffect(() => {
    loadAudioFiles()
    return () => {
      wsRef.current?.close()
      stopCurrent()
      stopProgress()
    }
  }, [])

  const loadAudioFiles = async () => {
    try {
      const res = await audioReviewApi.list()
      setAudioFiles(res.data)
    } catch {}
  }

  const handleGenerate = async () => {
    if (!eligible.length) return
    setIsGenerating(true)
    setJobState({ status: 'pending', progress: 0, total: eligible.length, filename: null, error: null })

    try {
      const wordIds = eligible.map((uw) => uw.word.id)
      const res = await audioReviewApi.generate(wordIds, order, gapSeconds, beep)
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
        // If closed unexpectedly (not code 1000) and still generating, mark error
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
      setJobState({ status: 'error', progress: 0, total: 0, filename: null, error: 'Request failed' })
      setIsGenerating(false)
    }
  }

  const handlePlay = async (filename: string) => {
    // If same file is already playing, stop it
    if (playingFile === filename) {
      stopCurrent()
      stopProgress()
      return
    }

    setLoadingPlay(filename)
    try {
      const res = await audioReviewApi.getFile(filename)
      const url = URL.createObjectURL(res.data as Blob)
      const audio = new Audio(url)

      // Stop previous progress tracking
      stopProgress()

      playingAudioRef.current = audio
      setPlayingFile(filename)

      audio.onended = () => {
        URL.revokeObjectURL(url)
        stopProgress()
      }

      playAudio(audio)

      // Start progress polling once metadata is available
      const startTracking = () => {
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current)
        setPlayProgress({ current: 0, total: audio.duration })
        progressIntervalRef.current = setInterval(() => {
          if (audio.paused || audio.ended) {
            stopProgress()
            return
          }
          setPlayProgress({ current: audio.currentTime, total: audio.duration })
        }, 250)
      }

      if (audio.readyState >= 1) {
        startTracking()
      } else {
        audio.onloadedmetadata = startTracking
      }
    } finally {
      setLoadingPlay(null)
    }
  }

  const handleDownload = async (filename: string) => {
    const res = await audioReviewApi.getFile(filename)
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleDelete = async (filename: string) => {
    try {
      await audioReviewApi.deleteFile(filename)
      setAudioFiles((prev) => prev.filter((f) => f.filename !== filename))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(filename)
        return next
      })
    } catch {}
  }

  const handleDeleteSelected = async () => {
    await Promise.allSettled([...selected].map((f) => audioReviewApi.deleteFile(f)))
    setAudioFiles((prev) => prev.filter((f) => !selected.has(f.filename)))
    setSelected(new Set())
  }

  const toggleSelect = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      return next
    })
  }

  const progressPct =
    jobState && jobState.total > 0
      ? Math.round((jobState.progress / jobState.total) * 100)
      : 0

  return (
    <div className="card space-y-4 animate-slide-up border-blue-500/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">
          🎧 {t('audioReview.title')}
        </p>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 transition-colors px-1"
        >
          ✕
        </button>
      </div>

      {/* Options — hidden while generating */}
      {!isGenerating && (
        <div className="space-y-3">
          {/* Order */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-400 w-20 shrink-0">{t('audioReview.orderLabel')}</span>
            <div className="flex gap-1 flex-wrap">
              {(['word_first', 'translation_first'] as const).map((o) => (
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

          {/* Beep toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-20 shrink-0">{t('audioReview.beepLabel')}</span>
            <button
              onClick={() => setBeep((v) => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${beep ? 'bg-blue-600' : 'bg-slate-600'}`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${beep ? 'left-5' : 'left-0.5'}`}
              />
            </button>
          </div>

          {/* Eligible count + generate button */}
          <div className="flex items-center gap-3 pt-1 border-t border-slate-700/60">
            <span className="text-xs text-slate-500 flex-1">
              {eligible.length > 0
                ? t('audioReview.eligibleWords', { count: eligible.length })
                : t('audioReview.noEligibleWords')}
            </span>
            <button
              onClick={handleGenerate}
              disabled={eligible.length === 0}
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
            {t('audioReview.generating', {
              progress: jobState.progress,
              total: jobState.total,
            })}
          </p>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {jobState?.status === 'error' && (
        <p className="text-sm text-red-400">{t('audioReview.errorGenerate')}</p>
      )}

      {/* Done — play / download */}
      {jobState?.status === 'done' && jobState.filename && (
        <div className="flex items-center gap-3 p-3 bg-green-900/20 border border-green-500/30 rounded-xl flex-wrap">
          <span className="text-green-400 text-sm flex-1">✓ {t('audioReview.done')}</span>
          <button
            onClick={() => handlePlay(jobState.filename!)}
            disabled={loadingPlay === jobState.filename}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            {loadingPlay === jobState.filename ? '…' : '▶'} {t('audioReview.play')}
          </button>
          <button
            onClick={() => handleDownload(jobState.filename!)}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            ↓ {t('audioReview.download')}
          </button>
        </div>
      )}

      {/* List of previously generated audios */}
      {audioFiles.length > 0 && (
        <div className="space-y-2 border-t border-slate-700/60 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500 uppercase tracking-widest">
              {t('audioReview.previousAudios')}
            </p>
            {selected.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                {t('audioReview.deleteSelected', { count: selected.size })}
              </button>
            )}
          </div>

          <div className="space-y-0.5 max-h-52 overflow-y-auto">
            {audioFiles.map((af) => (
              <div
                key={af.filename}
                className="flex flex-col gap-0.5 py-1.5 px-2 hover:bg-slate-700/30 rounded-lg group"
              >
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
                    <span className="text-xs text-blue-400 shrink-0 tabular-nums">
                      {formatDuration(playProgress.current)}/{formatDuration(playProgress.total)}
                    </span>
                  ) : af.duration_seconds != null ? (
                    <span className="text-xs text-slate-500 shrink-0">{formatDuration(af.duration_seconds)}</span>
                  ) : null}
                  <span className="text-xs text-slate-600 shrink-0">{af.size_kb} KB</span>
                  <button
                    onClick={() => handlePlay(af.filename)}
                    disabled={loadingPlay === af.filename}
                    title={playingFile === af.filename ? t('audioReview.stop') : t('audioReview.play')}
                    className={`transition-colors text-xs px-1 opacity-0 group-hover:opacity-100 ${
                      playingFile === af.filename
                        ? 'text-blue-400 hover:text-red-400 !opacity-100'
                        : 'text-slate-500 hover:text-blue-400'
                    }`}
                  >
                      {loadingPlay === af.filename ? '…' : playingFile === af.filename ? '■' : '▶'}
                  </button>
                  <button
                    onClick={() => handleDownload(af.filename)}
                    title={t('audioReview.download')}
                    className="text-slate-500 hover:text-green-400 transition-colors text-xs px-1 opacity-0 group-hover:opacity-100"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => handleDelete(af.filename)}
                    title={t('common.delete')}
                    className="text-slate-500 hover:text-red-400 transition-colors text-xs px-1 opacity-0 group-hover:opacity-100"
                  >
                    🗑
                  </button>
                </div>
                {/* Progress bar — only shown while playing */}
                {playingFile === af.filename && playProgress && playProgress.total > 0 && (
                  <div className="w-full bg-slate-700 rounded-full h-1 mt-0.5">
                    <div
                      className="bg-blue-500 h-1 rounded-full transition-all duration-200"
                      style={{ width: `${(playProgress.current / playProgress.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
