/**
 * SubtitlePlayer — Modal audio player with synchronized subtitle display.
 *
 * Subtitles are grouped by "word group": each group starts with the main pair
 * (word + translation) and may include extra-language entries after them.
 * Each language gets a distinct color:
 *   de → green, es → yellow, en → blue, fr → orange, it → red, pt → purple, others → slate
 *
 * Controls:
 *  - Play / Pause / Stop
 *  - ±5 seconds
 *  - Prev group / Next group
 *  - Extra gap slider
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseSrt, type SrtEntry } from '../utils/parseSrt'
import { stopCurrent } from '../utils/audioManager'

interface Props {
  audioBlob: Blob
  srtText: string
  filename: string
  onClose: () => void
}

// Color mapping per language code (active text + glow)
const LANG_COLORS: Record<string, { text: string; glow: string; dot: string }> = {
  de: { text: 'text-green-400',  glow: 'drop-shadow-[0_0_8px_rgba(74,222,128,0.6)]',  dot: 'bg-green-400' },
  es: { text: 'text-yellow-300', glow: 'drop-shadow-[0_0_8px_rgba(253,224,71,0.6)]',  dot: 'bg-yellow-300' },
  en: { text: 'text-blue-400',   glow: 'drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]',  dot: 'bg-blue-400' },
  fr: { text: 'text-orange-400', glow: 'drop-shadow-[0_0_8px_rgba(251,146,60,0.6)]',  dot: 'bg-orange-400' },
  it: { text: 'text-red-400',    glow: 'drop-shadow-[0_0_8px_rgba(248,113,113,0.6)]', dot: 'bg-red-400' },
  pt: { text: 'text-purple-400', glow: 'drop-shadow-[0_0_8px_rgba(192,132,252,0.6)]', dot: 'bg-purple-400' },
}
const DEFAULT_COLOR = { text: 'text-slate-300', glow: '', dot: 'bg-slate-400' }

function langColor(lang?: string) {
  return lang ? (LANG_COLORS[lang] ?? DEFAULT_COLOR) : DEFAULT_COLOR
}

function fmt(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/**
 * Group entries into word-groups. A new group starts every time we go back
 * to the "primary" language pair (de→es or es→de). With extra languages, a
 * group looks like: [de, es, en?, fr?, it?]
 *
 * Strategy: since the SRT has entries in order per word, and we know the
 * primary pair is always first (2 entries), we group every N entries where
 * N = 2 + number_of_extra_langs. But we don't know N at parse time.
 *
 * Simpler approach: group by detecting when the language sequence resets.
 * We look at consecutive entries and start a new group whenever we see the
 * same lang as the very first entry after having seen at least 2 entries.
 */
function groupEntries(entries: SrtEntry[]): SrtEntry[][] {
  if (!entries.length) return []

  const groups: SrtEntry[][] = []
  let current: SrtEntry[] = []
  const firstLang = entries[0].lang

  for (const entry of entries) {
    if (current.length >= 2 && entry.lang === firstLang) {
      // New word group starting
      groups.push(current)
      current = [entry]
    } else {
      current.push(entry)
    }
  }
  if (current.length) groups.push(current)
  return groups
}

export default function SubtitlePlayer({ audioBlob, srtText, filename, onClose }: Props) {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string>('')
  const rafRef = useRef<number | null>(null)

  const [entries] = useState<SrtEntry[]>(() => parseSrt(srtText))
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [extraGap, setExtraGap] = useState(0)

  const groups = groupEntries(entries)

  // Find current group and active entry index within it
  const currentGroupIdx = (() => {
    for (let i = groups.length - 1; i >= 0; i--) {
      if (currentTime >= groups[i][0].start) return i
    }
    return 0
  })()

  const activeGroup = groups[currentGroupIdx] ?? []
  const activeEntryIdx = (() => {
    for (let i = activeGroup.length - 1; i >= 0; i--) {
      const e = activeGroup[i]
      if (currentTime >= e.start && currentTime <= e.end + 0.1) return i
    }
    return -1
  })()

  // Set up audio
  useEffect(() => {
    stopCurrent()
    const url = URL.createObjectURL(audioBlob)
    audioUrlRef.current = url
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onloadedmetadata = () => setDuration(audio.duration)
    audio.onended = () => { setIsPlaying(false); setCurrentTime(audio.duration) }
    return () => {
      cancelAnimationFrame(rafRef.current ?? 0)
      audio.pause()
      URL.revokeObjectURL(url)
    }
  }, [audioBlob])

  const tick = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setCurrentTime(audio.currentTime)
    if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(tick)
  }, [])

  const play = useCallback(() => {
    audioRef.current?.play().then(() => {
      setIsPlaying(true)
      rafRef.current = requestAnimationFrame(tick)
    }).catch(() => {})
  }, [tick])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setIsPlaying(false)
    cancelAnimationFrame(rafRef.current ?? 0)
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setIsPlaying(false)
    setCurrentTime(0)
    cancelAnimationFrame(rafRef.current ?? 0)
  }, [])

  const seek = useCallback((to: number) => {
    const audio = audioRef.current
    if (!audio) return
    const clamped = Math.max(0, Math.min(duration, to))
    audio.currentTime = clamped
    setCurrentTime(clamped)
  }, [duration])

  const togglePlay = () => isPlaying ? pause() : play()

  const jumpToGroup = (idx: number) => {
    const target = groups[Math.max(0, Math.min(groups.length - 1, idx))]
    if (target?.[0]) seek(target[0].start)
  }

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    seek((e.clientX - rect.left) / rect.width * duration)
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col gap-4 p-5 animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400 font-mono truncate flex-1 mr-2">{filename}</p>
          <button onClick={() => { stop(); onClose() }} className="text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Subtitle display */}
        <div className="min-h-[8rem] flex flex-col items-center justify-center gap-1.5 px-2">
          {activeGroup.length > 0 ? (
            activeGroup.map((entry, i) => {
              const isActive = i === activeEntryIdx
              const color = langColor(entry.lang)
              const isMain = i < 2
              return (
                <p
                  key={entry.index}
                  className={`text-center transition-colors ${
                    isMain ? 'text-base font-semibold' : 'text-sm'
                  } ${
                    isActive
                      ? `${color.text} ${color.glow}`
                      : isMain ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {entry.lang && !isMain && (
                    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${color.dot} opacity-70`} />
                  )}
                  {entry.text}
                </p>
              )
            })
          ) : (
            <p className="text-slate-600 text-sm">{t('subtitlePlayer.noSubtitles')}</p>
          )}
        </div>

        {/* Group navigation */}
        {groups.length > 1 && (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <button
              onClick={() => jumpToGroup(currentGroupIdx - 1)}
              disabled={currentGroupIdx === 0}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ‹‹ {t('subtitlePlayer.prevPair')}
            </button>
            <span className="tabular-nums">{currentGroupIdx + 1} / {groups.length}</span>
            <button
              onClick={() => jumpToGroup(currentGroupIdx + 1)}
              disabled={currentGroupIdx >= groups.length - 1}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {t('subtitlePlayer.nextPair')} ››
            </button>
          </div>
        )}

        {/* Scrubber */}
        <div className="space-y-1">
          <div className="w-full h-2 bg-slate-700 rounded-full cursor-pointer relative group" onClick={handleScrub}>
            <div className="absolute top-0 left-0 h-2 bg-blue-500 rounded-full transition-none" style={{ width: `${pct}%` }} />
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: `calc(${pct}% - 6px)` }} />
          </div>
          <div className="flex justify-between text-xs text-slate-500 tabular-nums">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => seek(currentTime - 5)} title="-5s" className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors text-sm">⏮5</button>
          <button onClick={stop} title={t('subtitlePlayer.stop')} className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors">■</button>
          <button
            onClick={togglePlay}
            title={isPlaying ? t('subtitlePlayer.pause') : t('subtitlePlayer.play')}
            className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-colors text-xl shadow-lg"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={() => seek(currentTime + 5)} title="+5s" className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors text-sm">5⏭</button>
        </div>

        {/* Extra gap control */}
        <div className="flex items-center gap-3 pt-1 border-t border-slate-700/60">
          <span className="text-xs text-slate-400 shrink-0">{t('subtitlePlayer.extraGap')}</span>
          <div className="flex gap-1 flex-wrap">
            {[0, 1, 2, 3, 5].map((g) => (
              <button
                key={g}
                onClick={() => setExtraGap(g)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  extraGap === g
                    ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                    : 'border-slate-600 bg-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                {g === 0 ? t('subtitlePlayer.noGap') : `+${g}s`}
              </button>
            ))}
          </div>
        </div>

        {/* Word list */}
        {groups.length > 0 && (
          <div className="border-t border-slate-700/60 pt-2">
            <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">{t('subtitlePlayer.wordList')}</p>
            <div className="max-h-36 overflow-y-auto space-y-0.5">
              {groups.map((group, idx) => (
                <button
                  key={group[0].index}
                  onClick={() => jumpToGroup(idx)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5 flex-wrap ${
                    idx === currentGroupIdx
                      ? 'bg-blue-600/20 border border-blue-500/30'
                      : 'hover:bg-slate-800 border border-transparent'
                  }`}
                >
                  <span className="text-slate-500 shrink-0 tabular-nums w-6">{idx + 1}.</span>
                  {group.map((entry, ei) => {
                    const color = langColor(entry.lang)
                    const isActive = idx === currentGroupIdx && ei === activeEntryIdx
                    return (
                      <span
                        key={entry.index}
                        className={`${isActive ? color.text : ei < 2 ? 'text-slate-300' : 'text-slate-500'}`}
                      >
                        {ei > 0 && <span className="text-slate-600 mx-0.5">·</span>}
                        {entry.text}
                      </span>
                    )
                  })}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
