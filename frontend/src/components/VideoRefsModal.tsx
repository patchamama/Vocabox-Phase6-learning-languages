import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { subtitlesApi } from '../api/client'
import { useSettingsStore } from '../stores/settingsStore'
import type { SegmentRef, WordVideoRef } from '../types'

// ── Minimal YT IFrame API types ───────────────────────────────────────────────

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead?: boolean): void
  getCurrentTime(): number
  setPlaybackRate(rate: number): void
  destroy(): void
}

// ── Singleton YT API loader ───────────────────────────────────────────────────

let _ytReady = false
const _ytCallbacks: Array<() => void> = []

function ensureYTApi(cb: () => void) {
  if (_ytReady) { cb(); return }
  _ytCallbacks.push(cb)
  if (!document.getElementById('yt-iframe-api')) {
    ;(window as Record<string, unknown>)['onYouTubeIframeAPIReady'] = () => {
      _ytReady = true
      _ytCallbacks.splice(0).forEach((f) => f())
    }
    const s = document.createElement('script')
    s.id = 'yt-iframe-api'
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  }
}

// ── Highlight first matching term in text ─────────────────────────────────────

function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  for (const term of terms) {
    if (!term || term.length < 2) continue
    const lo = text.toLowerCase()
    const pos = lo.indexOf(term.toLowerCase())
    if (pos >= 0) {
      return (
        <>
          {text.slice(0, pos)}
          <mark className="bg-yellow-400/40 text-yellow-200 rounded-sm px-0.5 not-italic font-semibold">
            {text.slice(pos, pos + term.length)}
          </mark>
          {text.slice(pos + term.length)}
        </>
      )
    }
  }
  return <>{text}</>
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CtxData { before: SegmentRef[]; after: SegmentRef[] }

interface Props {
  wordId: number
  palabra: string
  significado: string
  audioText?: string
  onClose: () => void
  /** Pre-loaded refs (e.g. from subtitle search). Skips the API fetch when provided. */
  overrideRefs?: WordVideoRef[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VideoRefsModal({ wordId, palabra, significado, audioText, onClose, overrideRefs }: Props) {
  const { t } = useTranslation()
  const {
    videoClipPauseSec,
    videoClipContext,
    videoClipAutoPlay,
    videoClipPlaybackRate,
  } = useSettingsStore()

  const [refs, setRefs] = useState<WordVideoRef[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [autoPlay, setAutoPlay] = useState(videoClipAutoPlay)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [ctxCache, setCtxCache] = useState<Record<string, CtxData>>({})

  // DOM refs
  const overlayRef = useRef<HTMLDivElement>(null)
  const playerOuterRef = useRef<HTMLDivElement>(null)

  // Player + timer refs
  const playerRef = useRef<YTPlayer | null>(null)
  const pollRef = useRef<number | null>(null)
  const cdTimerRef = useRef<number | null>(null)

  // Mutable mirrors to avoid stale closures in intervals
  const autoPlayRef = useRef(autoPlay)
  const pauseSecRef = useRef(videoClipPauseSec)
  const playbackRateRef = useRef(videoClipPlaybackRate)
  const totalRef = useRef(0)

  useEffect(() => { autoPlayRef.current = autoPlay }, [autoPlay])
  useEffect(() => { pauseSecRef.current = videoClipPauseSec }, [videoClipPauseSec])
  useEffect(() => { playbackRateRef.current = videoClipPlaybackRate }, [videoClipPlaybackRate])
  useEffect(() => { totalRef.current = refs?.length ?? 0 }, [refs])

  // ── Load refs ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (overrideRefs) {
      setRefs(overrideRefs)
      return
    }
    subtitlesApi.getRefs(wordId)
      .then((r) => setRefs(r.data))
      .catch(() => setError('Error al cargar los clips'))
  }, [wordId, overrideRefs])

  // ── Escape key ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const current = refs?.[idx]
  const total = refs?.length ?? 0

  // ── Derive search terms (audio_text takes priority over palabra) ────────────
  // audio_text is the actual text used for the word's audio — may differ from palabra
  const searchTerms = [...new Set(
    [audioText, palabra, significado].filter((t): t is string => !!t && t.length >= 2)
  )]

  // ── Timer helpers ───────────────────────────────────────────────────────────
  const clearTimers = useCallback(() => {
    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null }
    if (cdTimerRef.current !== null) { clearInterval(cdTimerRef.current); cdTimerRef.current = null }
    setCountdown(null)
  }, [])

  const destroyPlayer = useCallback(() => {
    clearTimers()
    if (playerRef.current) {
      try { playerRef.current.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
    if (playerOuterRef.current) playerOuterRef.current.innerHTML = ''
  }, [clearTimers])

  const advanceClip = useCallback(() => {
    setCountdown(null)
    setIdx((i) => (i + 1) % totalRef.current)
  }, [])

  const scheduleAdvance = useCallback(() => {
    const sec = pauseSecRef.current
    if (sec <= 0) { advanceClip(); return }
    setCountdown(sec)
    let rem = sec
    cdTimerRef.current = window.setInterval(() => {
      rem--
      if (rem <= 0) {
        if (cdTimerRef.current !== null) { clearInterval(cdTimerRef.current); cdTimerRef.current = null }
        advanceClip()
      } else {
        setCountdown(rem)
      }
    }, 1000)
  }, [advanceClip])

  // Ref so polling interval always calls the latest version
  const onClipEndRef = useRef<() => void>(() => {})
  onClipEndRef.current = () => { if (autoPlayRef.current) scheduleAdvance() }

  // ── Main clip effect: load context (if needed), then create player ──────────
  useEffect(() => {
    if (!current) return
    destroyPlayer()
    setCountdown(null)

    const sid = current.segment.id
    const ctxKey = `${sid}_${videoClipContext}`
    const ytId = current.segment.file.youtube_id
    let cancelled = false

    const createPlayer = (ctxData?: CtxData) => {
      if (cancelled) return

      // Update context display
      if (ctxData) {
        setCtxCache((prev) => ({ ...prev, [ctxKey]: ctxData }))
      }

      // Compute playback window using context boundaries
      const contextBefore = ctxData?.before ?? []
      const contextAfter = ctxData?.after ?? []
      const startMs = contextBefore[0]?.start_ms ?? current.segment.start_ms
      const endMs = contextAfter[contextAfter.length - 1]?.end_ms ?? current.segment.end_ms
      const startSec = Math.max(0, startMs / 1000 - 0.3)
      const endSec = endMs / 1000

      if (!ytId) {
        // No YouTube ID: auto-advance after segment/context duration if autoPlay
        if (autoPlayRef.current) {
          const dur = Math.max(1500, endMs - startMs)
          cdTimerRef.current = window.setTimeout(() => {
            cdTimerRef.current = null
            onClipEndRef.current()
          }, dur) as unknown as number
        }
        return
      }

      ensureYTApi(() => {
        if (cancelled || !playerOuterRef.current) return
        const inner = document.createElement('div')
        playerOuterRef.current.appendChild(inner)

        playerRef.current = new (window as Record<string, unknown>)['YT'].Player(inner, {
          videoId: ytId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            start: Math.floor(startSec),
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
          },
          events: {
            onReady: (event: { target: YTPlayer }) => {
              if (cancelled) return
              event.target.seekTo(startSec, true)
              if (playbackRateRef.current !== 1) {
                event.target.setPlaybackRate(playbackRateRef.current)
              }
              event.target.playVideo()
              pollRef.current = window.setInterval(() => {
                if (!playerRef.current) return
                try {
                  if (playerRef.current.getCurrentTime() >= endSec) {
                    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null }
                    playerRef.current.pauseVideo()
                    onClipEndRef.current()
                  }
                } catch { /* player may be destroyed */ }
              }, 200)
            },
          },
        }) as YTPlayer
      })
    }

    // Load context first (if needed), then create player
    if (videoClipContext > 0) {
      const cached = ctxCache[ctxKey]
      if (cached) {
        createPlayer(cached)
      } else {
        subtitlesApi.getSegmentContext(sid, videoClipContext, videoClipContext)
          .then((r) => createPlayer({ before: r.data.before, after: r.data.after }))
          .catch(() => createPlayer(undefined))
      }
    } else {
      createPlayer(undefined)
    }

    return () => {
      cancelled = true
      destroyPlayer()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, refs])

  useEffect(() => destroyPlayer, [destroyPlayer])

  const handleOverlay = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const navigate = (delta: number) => {
    clearTimers()
    setIdx((i) => Math.max(0, Math.min(total - 1, i + delta)))
  }

  const ctxData = current ? ctxCache[`${current.segment.id}_${videoClipContext}`] : undefined

  // Compute display window for subtitle text
  const allContextSegs: Array<{ seg: SegmentRef; isCurrent: boolean }> = [
    ...(ctxData?.before ?? []).map((seg) => ({ seg, isCurrent: false })),
    ...(current ? [{ seg: current.segment, isCurrent: true }] : []),
    ...(ctxData?.after ?? []).map((seg) => ({ seg, isCurrent: false })),
  ]

  // Time range for display
  const displayStartMs = ctxData?.before?.[0]?.start_ms ?? current?.segment.start_ms
  const displayEndMs = ctxData?.after?.[ctxData.after.length - 1]?.end_ms ?? current?.segment.end_ms

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3"
      onClick={handleOverlay}
    >
      <div
        className={`bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ${
          isMaximized
            ? 'w-[96vw] h-[96vh]'
            : 'w-full max-w-lg max-h-[92vh]'
        }`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate">{audioText || palabra}</p>
            <p className="text-slate-400 text-xs truncate">{significado}</p>
          </div>
          <div className="flex items-center gap-1.5 ml-3 shrink-0">
            {total > 1 && (
              <button
                onClick={() => { clearTimers(); setAutoPlay((v) => !v) }}
                title={t('words.videoAutoPlay')}
                className={`text-sm px-2 py-1 rounded-lg border transition-colors ${
                  autoPlay
                    ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                    : 'border-slate-600 text-slate-500 hover:border-slate-400 hover:text-slate-300'
                }`}
              >↺</button>
            )}
            <button
              onClick={() => setIsMaximized((v) => !v)}
              title={isMaximized ? 'Reducir' : 'Maximizar'}
              className="text-slate-400 hover:text-white text-base px-1.5 py-1 rounded-lg border border-slate-600 hover:border-slate-400 transition-colors"
            >
              {isMaximized ? '⊡' : '⛶'}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none ml-1">✕</button>
          </div>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">

          {refs === null && !error && (
            <p className="text-slate-400 text-sm text-center py-6">{t('words.videoRefsLoading')}</p>
          )}
          {error && (
            <p className="text-red-400 text-sm text-center py-6">{error}</p>
          )}
          {refs !== null && total === 0 && (
            <p className="text-slate-400 text-sm text-center py-6">{t('words.videoRefsNone')}</p>
          )}

          {current && (
            <>
              {/* Clip counter + countdown + nav */}
              <div className="flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span>{t('words.videoClipOf', { n: idx + 1, total })}</span>
                  {countdown !== null && (
                    <span className="text-amber-400">{t('words.videoWaiting', { sec: countdown })}</span>
                  )}
                  {autoPlay && countdown === null && total > 1 && (
                    <span className="text-blue-400">↺</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigate(-1)}
                    disabled={total <= 1}
                    className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 transition-colors"
                  >←</button>
                  <button
                    onClick={() => navigate(1)}
                    disabled={total <= 1}
                    className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 transition-colors"
                  >→</button>
                </div>
              </div>

              {/* ── Video player ── */}
              {current.segment.file.youtube_id ? (
                <div
                  className="relative w-full rounded-xl overflow-hidden bg-black"
                  style={{ paddingTop: isMaximized ? '45%' : '56.25%' }}
                >
                  <div
                    ref={playerOuterRef}
                    className="absolute inset-0 [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:border-0"
                  />
                </div>
              ) : (
                <div className="bg-slate-700/50 rounded-xl p-4 text-center text-slate-400 text-sm">
                  {t('words.videoNoYoutubeId')}
                </div>
              )}

              {/* ── Subtitle context — concatenated ── */}
              <div className="bg-slate-700/40 rounded-xl px-3 py-2.5">
                <p className="text-sm leading-relaxed">
                  {allContextSegs.map(({ seg, isCurrent }) =>
                    isCurrent ? (
                      <span key={seg.id} className="text-slate-100">
                        <HighlightedText text={seg.text} terms={searchTerms} />{' '}
                      </span>
                    ) : (
                      <span key={seg.id} className="text-slate-500">{seg.text} </span>
                    )
                  )}
                </p>
                {displayStartMs !== undefined && displayEndMs !== undefined && (
                  <p className="text-xs text-slate-600 mt-1">
                    {fmtTime(displayStartMs)}–{fmtTime(displayEndMs)}
                    {' · '}
                    <span>{current.segment.file.filename}</span>
                  </p>
                )}
              </div>

              {/* ── Actions ── */}
              <div className="flex gap-2 items-center">
                {current.segment.file.youtube_id && (
                  <a
                    href={`https://youtu.be/${current.segment.file.youtube_id}?t=${Math.floor((displayStartMs ?? current.segment.start_ms) / 1000)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center btn-secondary text-sm py-2"
                  >
                    ↗ {t('words.videoOpenYoutube')}
                  </a>
                )}
                {total > 1 && (
                  <div className="flex items-center gap-1.5 flex-wrap justify-center flex-1">
                    {refs.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => { clearTimers(); setIdx(i) }}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          i === idx ? 'bg-blue-400' : 'bg-slate-600 hover:bg-slate-500'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
