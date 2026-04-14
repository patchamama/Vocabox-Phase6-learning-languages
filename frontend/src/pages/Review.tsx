import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AnagramExercise from '../components/exercises/AnagramExercise'
import FirstLetterExercise from '../components/exercises/FirstLetterExercise'
import MultipleChoiceExercise from '../components/exercises/MultipleChoiceExercise'
import PairMatchExercise from '../components/exercises/PairMatchExercise'
import WriteExercise from '../components/exercises/WriteExercise'
import WordEditForm from '../components/WordEditForm'
import { useReviewStore } from '../stores/reviewStore'
import { useSettingsStore } from '../stores/settingsStore'
import { stripAccent } from '../utils/normalize'
import { ShortcutLabel } from '../utils/shortcutLabel'

interface LastEntry {
  question: string
  input: string
  correctAnswer: string
  wasCorrect: boolean
}

const BOX_BG = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-400',
  'bg-lime-400',
  'bg-cyan-400',
  'bg-blue-500',
  'bg-purple-500',
]

// ── Confetti burst ────────────────────────────────────────────────────────────
function fireConfetti() {
  const end = Date.now() + 2200
  const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa']
  const frame = () => {
    confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 }, colors })
    confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 }, colors })
    if (Date.now() < end) requestAnimationFrame(frame)
  }
  frame()
}

// ── ProgressBar (isolated to prevent re-renders on tooltip hover) ─────────────
const ProgressBar = memo(function ProgressBar({
  greenPct, redPct, errSize, errResolved, correctWords, incorrectWords, t,
}: {
  greenPct: number; redPct: number; errSize: number; errResolved: number
  correctWords: string[]; incorrectWords: string[]
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [tooltip, setTooltip] = useState<{ lines: string[]; color: 'blue' | 'red' } | null>(null)

  return (
    <div className="relative">
      <div className="bg-slate-700 rounded-full h-2 flex overflow-hidden">
        <div className="bg-blue-500 h-2 transition-all duration-500" style={{ width: `${greenPct}%` }} />
        {redPct > 0 && (
          <div className="bg-red-500/70 h-2 transition-all duration-500" style={{ width: `${redPct}%` }} />
        )}
      </div>

      {/* Hover zones */}
      <div className="absolute flex" style={{ inset: '-6px 0' }}>
        {greenPct > 0 && (
          <div
            className="h-full cursor-default"
            style={{ width: `${greenPct}%` }}
            onMouseEnter={() => correctWords.length > 0 && setTooltip({ lines: correctWords, color: 'blue' })}
            onMouseLeave={() => setTooltip(null)}
          />
        )}
        {redPct > 0 && (
          <div
            className="h-full cursor-default"
            style={{ width: `${redPct}%` }}
            onMouseEnter={() => incorrectWords.length > 0 && setTooltip({ lines: incorrectWords, color: 'red' })}
            onMouseLeave={() => setTooltip(null)}
          />
        )}
      </div>

      {errSize > 0 && (
        <p
          className="text-xs text-red-400/70 mt-0.5 text-right cursor-default"
          onMouseEnter={() => incorrectWords.length > 0 && setTooltip({ lines: incorrectWords, color: 'red' })}
          onMouseLeave={() => setTooltip(null)}
        >
          {t('session.errorPending', { count: errSize - errResolved })}
        </p>
      )}

      {tooltip && (
        <div className={`absolute top-full mt-1 left-0 z-50 max-w-xs rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none
          ${tooltip.color === 'blue' ? 'bg-blue-900/95 text-blue-100 border border-blue-700' : 'bg-red-900/95 text-red-100 border border-red-700'}`}>
          {tooltip.lines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  )
})

const LAST_ERRORS_KEY = 'vocabox:lastErrors'

export function getLastErrors(): number[] {
  try { return JSON.parse(localStorage.getItem(LAST_ERRORS_KEY) ?? '[]') } catch { return [] }
}

export default function Review() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    reviewMode, wordsPerSession, transitionDelay, transitionType,
    safeRound1, safeRound2, safeRound3, autoPlayAudio, autoPlayAudioReversed, wordsOnly, reviewDirection,
  } = useSettingsStore()

  const {
    isLoading,
    isFinished,
    inErrorPhase,
    currentRound,
    totalRounds,
    allWords,
    correctWordIds,
    incorrectWordIds,
    results,
    loadReview,
    handleSingleAnswer,
    handlePairMatchComplete,
    patchWord,
    currentWord,
    currentExerciseType,
    currentPairWords,
    errorQueueSize,
    errorResolvedCount,
    totalIterations,
    doneIterations,
    sessionConfig,
  } = useReviewStore()

  const [lastEntry, setLastEntry] = useState<LastEntry | null>(null)
  const [pendingAdvance, setPendingAdvance] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [headerTooltip, setHeaderTooltip] = useState<{ lines: string[]; color: 'blue' | 'red' } | null>(null)
  // Derived: show banner when active session was loaded with different config
  const settingsChangedBanner = !isFinished && allWords.length > 0 && sessionConfig !== null && (
    sessionConfig.reviewDirection !== reviewDirection ||
    sessionConfig.reviewMode !== reviewMode ||
    sessionConfig.wordsPerSession !== wordsPerSession ||
    sessionConfig.wordsOnly !== wordsOnly
  )

  // Pick a motivational phrase matching session languages (stable per session-finish)
  const motivationalPhrase = useMemo(() => {
    if (!isFinished) return ''
    type MotivEntry = { text: string; langs: string[] }
    const all = t('session.motivational', { returnObjects: true }) as MotivEntry[]
    if (!Array.isArray(all) || all.length === 0) return ''

    // Collect unique languages used in this session
    const sessionLangs = new Set<string>()
    for (const w of allWords) {
      sessionLangs.add(w.idioma_origen)
      sessionLangs.add(w.idioma_destino)
    }

    // Priority 1: phrase whose langs overlap session languages
    const matching = all.filter(
      (e) => e.langs.length > 0 && e.langs.some((l) => sessionLangs.has(l))
    )
    // Priority 2: universal phrases (langs: [])
    const universal = all.filter((e) => e.langs.length === 0)

    const pool = matching.length > 0 ? matching : universal.length > 0 ? universal : all
    return pool[Math.floor(Math.random() * pool.length)].text
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinished])

  // On session finish: confetti + persist last errors
  useEffect(() => {
    if (!isFinished) return
    const totalW = allWords.length
    const incorrectC = incorrectWordIds.length
    const correctC = totalW - incorrectC
    const pctC = totalW > 0 ? Math.round((correctC / totalW) * 100) : 0
    if (pctC >= 85) fireConfetti()
    // Extra confetti for mastered words (in C6, correct, and NOT in incorrectWordIds)
    const hasMastered = correctWordIds
      .filter((id) => !incorrectWordIds.includes(id))
      .some((id) => allWords.find((w) => w.user_word_id === id)?.box_level === 6)
    if (hasMastered) setTimeout(fireConfetti, 1200)
    // Persist incorrect word ids for "last errors" filter in Words page
    localStorage.setItem(LAST_ERRORS_KEY, JSON.stringify(incorrectWordIds))
  }, [isFinished, allWords.length, incorrectWordIds.length, correctWordIds, allWords])

  const boxesParam = searchParams.get('boxes')
  const selectedBoxes = boxesParam
    ? boxesParam.split(',').map(Number).filter((n) => !isNaN(n))
    : undefined

  useEffect(() => {
    // Only load if not already in an active session
    const state = useReviewStore.getState()
    if (!state.isFinished && state.allWords.length === 0) {
      loadReview(selectedBoxes, wordsPerSession, reviewMode, [safeRound1, safeRound2, safeRound3], wordsOnly, reviewDirection)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // ── Transition logic ─────────────────────────────────────────────────────────
  /**
   * Schedule or show a "continue" button before calling the actual advance action.
   * Used by all single-word exercises after they resolve.
   */
  const scheduleAdvance = (action: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (transitionType === 'button') {
      setPendingAction(() => action)
      setPendingAdvance(true)
    } else {
      setPendingAdvance(true)
      const ms = transitionDelay * 1000
      timerRef.current = setTimeout(() => {
        setPendingAdvance(false)
        setPendingAction(null)
        action()
      }, ms)
    }
  }

  const confirmAdvance = useCallback(() => {
    if (!pendingAction) return
    if (timerRef.current) clearTimeout(timerRef.current)
    setPendingAdvance(false)
    const fn = pendingAction
    setPendingAction(null)
    fn()
  }, [pendingAction])

  useEffect(() => {
    if (!pendingAdvance || transitionType !== 'button') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmAdvance(); return }
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key.length !== 1) return
      const key = stripAccent(e.key.toLowerCase())
      const label = t('session.continue')
      const firstKey = stripAccent(label[0].toLowerCase())
      if (key === firstKey) { e.preventDefault(); confirmAdvance() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pendingAdvance, transitionType, confirmAdvance, t])

  // ── Answer handlers ──────────────────────────────────────────────────────────
  const onSingleAnswer = (correct: boolean, userInput: string = '') => {
    const word = currentWord()
    if (!word) return
    const capturedId = word.user_word_id
    setLastEntry({ question: word.palabra, input: userInput, correctAnswer: word.significado, wasCorrect: correct })
    setIsEditing(false)
    scheduleAdvance(() => handleSingleAnswer(capturedId, correct))
  }

  // ── Loading / Finished ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <div className="text-4xl">⏳</div>
        <p className="text-slate-400">Cargando palabras...</p>
      </div>
    )
  }

  if (isFinished) {
    // ── Integrity checks ─────────────────────────────────────────────────────
    // 1. Any ID in both lists? Remove from correct (incorrect is authoritative).
    const crossIds = correctWordIds.filter((id) => incorrectWordIds.includes(id))
    if (crossIds.length > 0) {
      console.error(
        '[Review] INTEGRITY: IDs found in both correctWordIds and incorrectWordIds — removing from correct.',
        crossIds.map((id) => {
          const w = allWords.find((w) => w.user_word_id === id)
          return `id=${id} palabra="${w?.palabra ?? '?'}"`
        })
      )
    }
    const safeCorrectIds = correctWordIds.filter((id) => !incorrectWordIds.includes(id))

    // 2. sum check: correct + incorrect must equal total words in session
    const expectedTotal = allWords.length
    const actualSum = safeCorrectIds.length + incorrectWordIds.length
    if (actualSum !== expectedTotal) {
      console.error(
        `[Review] INTEGRITY: correct(${safeCorrectIds.length}) + incorrect(${incorrectWordIds.length}) = ${actualSum} ≠ totalWords(${expectedTotal}).`,
        'Missing IDs:',
        allWords
          .filter((w) => !safeCorrectIds.includes(w.user_word_id) && !incorrectWordIds.includes(w.user_word_id))
          .map((w) => `id=${w.user_word_id} palabra="${w.palabra}"`)
      )
    }

    // Word-level summary: a word is "incorrect" if it failed at least once,
    // "correct" only if it never failed.
    const totalWords = allWords.length
    const incorrectCount = incorrectWordIds.length
    const correctCount = safeCorrectIds.length
    const total = totalWords
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0
    const boxPrefix = t('box.prefix')

    // Build flow diagram from correctWordIds / incorrectWordIds — deterministic, no async deps.
    // Correct words (never failed) → advanced one box (or stayed at 6 = mastered).
    // Incorrect words (failed at least once) → dropped to box 0.
    const advanced: Record<number, number> = {}
    const dropped: Record<number, number> = {}
    const advancedWords: Record<number, string[]> = {}
    const droppedWords: Record<number, string[]> = {}
    const masteredWords: string[] = []

    for (const id of safeCorrectIds) {
      const w = allWords.find((w) => w.user_word_id === id)
      if (!w) continue
      const fromBox = w.box_level
      const label = w.palabra
      if (fromBox === 6) {
        masteredWords.push(label)
      } else {
        advanced[fromBox] = (advanced[fromBox] ?? 0) + 1
        advancedWords[fromBox] = [...(advancedWords[fromBox] ?? []), label]
      }
    }

    for (const id of incorrectWordIds) {
      const w = allWords.find((w) => w.user_word_id === id)
      if (!w) continue
      const fromBox = w.box_level
      const label = w.palabra
      if (fromBox === 0) {
        // Was already in C0, failed → stays in C0. Skip (no movement to show).
        // Still appears in "Errors by box" section below.
        void label
      } else {
        dropped[fromBox] = (dropped[fromBox] ?? 0) + 1
        droppedWords[fromBox] = [...(droppedWords[fromBox] ?? []), label]
      }
    }

    const activeBoxes = [
      ...new Set([
        ...safeCorrectIds.map((id) => allWords.find((w) => w.user_word_id === id)?.box_level ?? -1),
        ...incorrectWordIds.map((id) => allWords.find((w) => w.user_word_id === id)?.box_level ?? -1),
      ].filter((b) => b >= 0)),
    ].sort((a, b) => a - b)

    return (
      <div className="p-4 pt-8 min-h-screen flex flex-col items-center">
        <div className="w-full max-w-sm space-y-5 animate-slide-up">

          {/* Header */}
          <div className="text-center">
            <div className="text-6xl mb-3">{total === 0 ? '📭' : pct >= 85 ? '🏆' : pct >= 70 ? '🎉' : '💪'}</div>
            <h2 className="text-2xl font-bold">
              {total === 0 ? t('session.noWords') : t('session.completed')}
            </h2>
            {motivationalPhrase && (
              <p className="mt-3 text-sm text-blue-300 italic leading-snug px-2">
                {motivationalPhrase}
              </p>
            )}
          </div>

          {/* Mastered words (C6 → stayed at C6) */}
          {masteredWords.length > 0 && (
            <div className="card text-center space-y-2 border border-yellow-500/40 bg-yellow-500/5">
              <div className="text-3xl">🌟</div>
              <h3 className="text-sm font-bold text-yellow-300">{t('session.mastered', { count: masteredWords.length })}</h3>
              <p className="text-[11px] text-yellow-200/70 leading-snug">{masteredWords.join(' · ')}</p>
            </div>
          )}

          {/* Accuracy + totals */}
          {total > 0 && (
            <div className="card text-center space-y-3">
              <p className="text-slate-400 text-sm">{t('session.accuracy')}: <span className="font-bold text-white">{pct}%</span></p>
              <div className="flex justify-center gap-8">
                <div>
                  <div className="text-3xl font-bold text-green-400">{correctCount}</div>
                  <div className="text-xs text-slate-400 mt-1">{t('session.correct')}</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-red-400">{incorrectCount}</div>
                  <div className="text-xs text-slate-400 mt-1">{t('session.incorrect')}</div>
                </div>
              </div>
            </div>
          )}

          {/* Box flow diagram */}
          {activeBoxes.length > 0 && (
            <div className="card space-y-3">
              <h3 className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">{t('session.boxFlow')}</h3>

              <div className="overflow-x-auto">
                {/* Row 1: C0 pill + down-arrow toward C1 row (only if words advanced from C0) */}
                {(advanced[0] ?? 0) > 0 && (
                  <div className="flex flex-col items-start mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${BOX_BG[0]} text-slate-900`}>
                      {boxPrefix}0
                    </span>
                    <div
                      className="flex flex-col items-center ml-1 leading-tight cursor-default text-green-400"
                      title={(advancedWords[0] ?? []).join(', ')}
                    >
                      <span className="text-[9px] font-semibold">{advanced[0]}</span>
                      <span className="text-xs leading-none">↓</span>
                    </div>
                  </div>
                )}

                {/* Row 2: C1–C6 chain */}
                <div className="flex items-start gap-0.5">
                  {[1, 2, 3, 4, 5, 6].map((box, idx) => {
                    const adv = advanced[box] ?? 0
                    const drop = dropped[box] ?? 0
                    const hasActivity = activeBoxes.includes(box) || adv > 0 || drop > 0
                    return (
                      <div key={box} className="flex items-start gap-0.5">
                        {/* Box pill + optional drop badge below */}
                        <div className={`flex flex-col items-center gap-0.5 ${!hasActivity ? 'opacity-20' : ''}`}>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${BOX_BG[box] ?? 'bg-slate-600'} text-slate-900`}>
                            {boxPrefix}{box}
                          </span>
                          {drop > 0 && (
                            <div
                              className="flex flex-col items-center leading-tight cursor-default"
                              title={(droppedWords[box] ?? []).join(', ')}
                            >
                              <span className="text-red-400 text-[9px] font-medium">↓{drop}</span>
                              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-900/60 text-red-300">
                                {boxPrefix}0
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Horizontal advance arrow to next box */}
                        {idx < 5 && (
                          <span
                            className={`text-[10px] font-medium pt-0.5 cursor-default ${adv > 0 ? 'text-green-400' : 'text-slate-700'}`}
                            title={adv > 0 ? (advancedWords[box] ?? []).join(', ') : undefined}
                          >
                            {adv > 0 ? `→${adv}` : '→'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Legend */}
              <div className="flex gap-4 justify-center text-[9px] text-slate-500">
                <span><span className="text-green-400">↓N →N</span> {t('session.advanced')}</span>
                <span><span className="text-red-400">↓N {boxPrefix}0</span> {t('session.droppedToZero', { prefix: boxPrefix })}</span>
              </div>
            </div>
          )}

          {/* Errors by box */}
          {incorrectWordIds.length > 0 && (() => {
            // Group incorrect words by their original box (box_level from allWords, captured at load time)
            const byBox: Record<number, string[]> = {}
            for (const id of incorrectWordIds) {
              const w = allWords.find((w) => w.user_word_id === id)
              if (!w) continue
              byBox[w.box_level] = [...(byBox[w.box_level] ?? []), w.palabra]
            }
            const sortedBoxes = Object.keys(byBox).map(Number).sort((a, b) => a - b)
            return (
              <div className="card space-y-3">
                <h3 className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">{t('session.errorsByBox')}</h3>
                {sortedBoxes.map((box) => (
                  <div key={box} className="space-y-1">
                    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${BOX_BG[box] ?? 'bg-slate-600'} text-slate-900`}>
                      {boxPrefix}{box}
                    </span>
                    <p className="text-[11px] text-red-300/80 leading-snug">
                      {byBox[box].join(' · ')}
                    </p>
                  </div>
                ))}
                <button
                  onClick={() => navigate('/words?filter=lastErrors')}
                  className="w-full text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 rounded-xl py-2 px-3 transition-colors bg-blue-500/5 hover:bg-blue-500/10"
                >
                  🔍 {t('session.reviewErrors')}
                </button>
              </div>
            )
          })()}

          <button
            onClick={() => loadReview(selectedBoxes, wordsPerSession, reviewMode, [safeRound1, safeRound2, safeRound3], wordsOnly, reviewDirection)}
            className="btn-primary w-full"
          >
            {total === 0 ? t('session.refresh') : t('session.newSession')}
          </button>
        </div>
      </div>
    )
  }

  const word = currentWord()
  const exerciseType = currentExerciseType()
  const pairWords = currentPairWords()
  const isPairMode = exerciseType === 'pair_match'
  // Auto-play: suppress when reversed unless explicitly enabled
  const shouldAutoPlay = autoPlayAudio && (word?.reversed ? autoPlayAudioReversed : true)

  if (!isPairMode && !word) return null
  if (isPairMode && pairWords.length < 2) return null

  // ── Progress — iteration-based (not word-based) ──────────────────────────────
  // greenPct = correct iterations / total iterations
  // redPct   = incorrect iterations / total iterations
  // Both grow independently, never shrink.
  const totalIter = totalIterations()
  const greenPct = totalIter > 0 ? (results.correct / totalIter) * 100 : 0
  const redPct   = totalIter > 0 ? (results.incorrect / totalIter) * 100 : 0
  const errSize = errorQueueSize()
  const errResolved = errorResolvedCount()

  // Words lists for tooltips
  const wordName = (id: number) => {
    const w = allWords.find((w) => w.user_word_id === id)
    return w ? `${w.palabra} (${t('box.prefix')}${w.box_level})` : String(id)
  }
  const correctWords = correctWordIds.map((id, i) => `${i + 1}. ${wordName(id)}`)
  const incorrectWords = incorrectWordIds.map((id, i) => `${i + 1}. ${wordName(id)}`)

  const autoAdvanceMs = transitionType === 'auto' ? transitionDelay * 1000 : undefined

  return (
    <div className="p-4 pt-8 min-h-screen flex flex-col">

      {/* ── Settings changed banner ── */}
      {settingsChangedBanner && (
        <div className="mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm animate-slide-up">
          <span>⚙ {t('session.settingsChanged')}</span>
          <button
            onClick={() => {
              loadReview(selectedBoxes, wordsPerSession, reviewMode, [safeRound1, safeRound2, safeRound3], wordsOnly, reviewDirection)
            }}
            className="text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg px-3 py-1 transition-colors shrink-0"
          >
            {t('session.newSession')}
          </button>
        </div>
      )}

      {/* ── Progress bar ── */}
      <div className="mb-4 relative">
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="text-slate-400 flex items-center gap-1.5">
            {reviewMode === 'safe' && !inErrorPhase && (
              <span className="text-xs bg-slate-600 text-slate-300 px-1.5 py-0.5 rounded-full font-medium">
                R{currentRound + 1}/{totalRounds}
              </span>
            )}
            {inErrorPhase
              ? t('session.errorReview')
              : exerciseType ? t(`settings.exercises.${exerciseType}`) : ''}
          </span>
          <div className="flex items-center gap-2">
            {correctWordIds.length > 0 && (
              <span
                className="text-green-400 font-medium cursor-default"
                onMouseEnter={() => correctWords.length > 0 && setHeaderTooltip({ lines: correctWords, color: 'blue' })}
                onMouseLeave={() => setHeaderTooltip(null)}
              >✓ {correctWordIds.length}</span>
            )}
            {incorrectWordIds.length > 0 && (
              <span
                className="text-red-400 font-medium cursor-default"
                onMouseEnter={() => incorrectWords.length > 0 && setHeaderTooltip({ lines: incorrectWords, color: 'red' })}
                onMouseLeave={() => setHeaderTooltip(null)}
              >✗ {incorrectWordIds.length}</span>
            )}
            <span className="text-slate-500">{totalIterations() - doneIterations()}</span>
            {!isPairMode && word && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold text-slate-900 ${BOX_BG[word.box_level] ?? 'bg-slate-500'}`}
              >
                {t('box.prefix')}{word.box_level}
              </span>
            )}
            {!isPairMode && word?.tema_nombre && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                style={{ backgroundColor: word.tema_color ?? '#64748b' }}
              >
                {word.tema_nombre}
              </span>
            )}
            {!isPairMode && !pendingAdvance && (
              <button
                onClick={() => setIsEditing((v) => !v)}
                title={isEditing ? 'Cerrar edición' : 'Editar palabra'}
                className={`px-1 transition-colors ${
                  isEditing ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                ✎
              </button>
            )}
          </div>
        </div>

        <ProgressBar
          greenPct={greenPct}
          redPct={redPct}
          errSize={errSize}
          errResolved={errResolved}
          correctWords={correctWords}
          incorrectWords={incorrectWords}
          t={t as (key: string, opts?: Record<string, unknown>) => string}
        />

        {headerTooltip && (
          <div className={`absolute top-full mt-1 left-0 z-50 max-w-xs rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none
            ${headerTooltip.color === 'blue' ? 'bg-blue-900/95 text-blue-100 border border-blue-700' : 'bg-red-900/95 text-red-100 border border-red-700'}`}>
            {headerTooltip.lines.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>

      {/* ── Inline edit panel ── */}
      {isEditing && word && (
        <div className="mb-4">
          <WordEditForm
            word={{
              word_id: word.word_id,
              palabra: word.palabra,
              significado: word.significado,
              idioma_origen: word.idioma_origen,
              idioma_destino: word.idioma_destino,
              tema_id: word.tema_id,
              audio_url: word.audio_url,
              audio_url_translation: word.audio_url_translation,
            }}
            onSaved={({ tema, ...rest }) => {
              patchWord(word.user_word_id, {
                ...rest,
                tema_nombre: tema?.nombre ?? null,
                tema_color: tema?.color ?? null,
              })
              setIsEditing(false)
            }}
            onCancel={() => setIsEditing(false)}
            onDeleted={() => { setIsEditing(false); loadReview(selectedBoxes, wordsPerSession, reviewMode, [safeRound1, safeRound2, safeRound3], wordsOnly, reviewDirection) }}
          />
        </div>
      )}

      {/* ── Exercise ── */}
      <div className="flex-1 pb-32">
        {isPairMode ? (
          <PairMatchExercise
            key={pairWords.map((w) => w.user_word_id).join('-')}
            words={pairWords}
            onComplete={(incorrectIds) => {
              setLastEntry(null)
              handlePairMatchComplete(incorrectIds)
            }}
          />
        ) : pendingAdvance ? (
          /* Transition state: show result + continue button */
          <div className="space-y-4 animate-slide-up">
            {lastEntry && (
              <div className={`card text-center border-2 ${lastEntry.wasCorrect ? 'border-green-500/50' : 'border-red-500/50'}`}>
                <p className={`text-lg font-bold mb-1 ${lastEntry.wasCorrect ? 'text-green-400' : 'text-red-400'}`}>
                  {lastEntry.wasCorrect ? t('settings.exercises.correct') : t('settings.exercises.incorrect')}
                </p>
                <p className="text-slate-500 text-xs mb-1">{lastEntry.question}</p>
                {!lastEntry.wasCorrect && lastEntry.input && (
                  <p className="text-sm text-slate-400 mb-1">{t('settings.exercises.yourAnswer')}: {lastEntry.input}</p>
                )}
                <p className="text-slate-200">{lastEntry.correctAnswer}</p>
              </div>
            )}
            {transitionType === 'button' ? (
              <button onClick={confirmAdvance} className="btn-primary w-full">
                <ShortcutLabel
                  text={t('session.continue')}
                  shortcut={stripAccent(t('session.continue')[0].toLowerCase())}
                />
              </button>
            ) : (
              <div className="text-center text-xs text-slate-500">
                {t('session.continuingIn', { seconds: transitionDelay })}
              </div>
            )}
          </div>
        ) : word && exerciseType === 'write' ? (
          <WriteExercise
            key={word.user_word_id}
            word={word}
            autoPlay={shouldAutoPlay}
            onAnswer={(correct, input) => onSingleAnswer(correct, input)}
          />
        ) : word && exerciseType === 'multiple_choice' ? (
          <MultipleChoiceExercise
            key={word.user_word_id}
            word={word}
            autoPlay={shouldAutoPlay}
            onAnswer={(correct, input) => onSingleAnswer(correct, input)}
          />
        ) : word && exerciseType === 'first_letter' ? (
          <FirstLetterExercise
            key={word.user_word_id}
            word={word}
            autoPlay={shouldAutoPlay}
            autoAdvanceMs={autoAdvanceMs}
            onAnswer={(correct) => onSingleAnswer(correct)}
          />
        ) : word && exerciseType === 'anagram' ? (
          <AnagramExercise
            key={word.user_word_id}
            word={word}
            onAnswer={(correct) => onSingleAnswer(correct)}
          />
        ) : null}
      </div>

      {/* ── Último resultado (sticky bottom, visible siempre) ── */}
      {lastEntry && !pendingAdvance && (() => {
        const totalChars = (lastEntry.question + lastEntry.input + lastEntry.correctAnswer).length
        const isLong = totalChars > 80
        return (
          <div className="fixed bottom-[60px] left-0 right-0 border-t border-slate-700/60 bg-slate-900/95 backdrop-blur-sm">
            <div className={`max-w-lg mx-auto px-4 pt-2 pb-2 text-xs text-slate-500 flex flex-wrap gap-x-2 gap-y-0.5 items-baseline${isLong ? ' max-h-[4.5rem] overflow-y-auto' : ''}`}>
              <span className="text-slate-600">{lastEntry.question}</span>
              <span className="text-slate-700">·</span>
              <span className={lastEntry.wasCorrect ? 'text-green-400' : 'text-red-400'}>
                {lastEntry.input || '—'}
              </span>
              <span className="text-slate-700">→</span>
              <span className="text-slate-400">{lastEntry.correctAnswer}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
