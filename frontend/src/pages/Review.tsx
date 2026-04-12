import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
        {errSize > 0 && (
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
        {errSize > 0 && redPct > 0 && (
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

export default function Review() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const {
    reviewMode, wordsPerSession, transitionDelay, transitionType,
    safeRound1, safeRound2, safeRound3, autoPlayAudio, wordsOnly,
  } = useSettingsStore()

  const {
    results,
    boxMoves,
    isLoading,
    isFinished,
    inErrorPhase,
    errorQueue,
    currentRound,
    totalRounds,
    allWords,
    correctWordIds,
    incorrectWordIds,
    loadReview,
    handleSingleAnswer,
    handlePairMatchComplete,
    patchWord,
    reset,
    currentWord,
    currentExerciseType,
    currentPairWords,
    progressPct,
    errorQueueSize,
    errorResolvedCount,
  } = useReviewStore()

  const [lastEntry, setLastEntry] = useState<LastEntry | null>(null)
  const [pendingAdvance, setPendingAdvance] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isEditing, setIsEditing] = useState(false)

  const boxesParam = searchParams.get('boxes')
  const selectedBoxes = boxesParam
    ? boxesParam.split(',').map(Number).filter((n) => !isNaN(n))
    : undefined

  useEffect(() => {
    // Only load if not already in an active session
    const state = useReviewStore.getState()
    if (!state.isFinished && state.allWords.length === 0) {
      loadReview(selectedBoxes, wordsPerSession, reviewMode, [safeRound1, safeRound2, safeRound3], wordsOnly)
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
    // Word-level summary: a word is "incorrect" if it failed at least once,
    // "correct" only if it never failed. Avoids inflating counts in safe mode (3 rounds).
    const totalWords = allWords.length
    const incorrectCount = incorrectWordIds.length
    const correctCount = totalWords - incorrectCount
    const total = totalWords
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0
    const boxPrefix = t('box.prefix')

    // Build flow data: which boxes had movement
    // advanced[fromBox]      = count that moved UP
    // dropped[fromBox]       = count that fell to 0
    // advancedWords[fromBox] = word labels that moved UP
    // droppedWords[fromBox]  = word labels that fell to 0
    const advanced: Record<number, number> = {}
    const dropped: Record<number, number> = {}
    const advancedWords: Record<number, string[]> = {}
    const droppedWords: Record<number, string[]> = {}

    const wordLabel = (id: number) => {
      const w = allWords.find((w) => w.user_word_id === id)
      return w ? w.word : String(id)
    }

    for (const m of boxMoves) {
      const label = wordLabel(m.userWordId)
      if (m.toBox === 0 && m.fromBox > 0) {
        dropped[m.fromBox] = (dropped[m.fromBox] ?? 0) + 1
        droppedWords[m.fromBox] = [...(droppedWords[m.fromBox] ?? []), label]
      } else if (m.toBox === 0 && m.fromBox === 0) {
        // failed while in C0 — show on the C0→C1 arrow as red
        dropped[0] = (dropped[0] ?? 0) + 1
        droppedWords[0] = [...(droppedWords[0] ?? []), label]
      } else if (m.toBox > m.fromBox) {
        advanced[m.fromBox] = (advanced[m.fromBox] ?? 0) + 1
        advancedWords[m.fromBox] = [...(advancedWords[m.fromBox] ?? []), label]
      }
    }
    // Boxes that had any activity
    const activeBoxes = [...new Set(boxMoves.map((m) => m.fromBox))].sort((a, b) => a - b)

    return (
      <div className="p-4 pt-8 min-h-screen flex flex-col items-center">
        <div className="w-full max-w-sm space-y-5 animate-slide-up">

          {/* Header */}
          <div className="text-center">
            <div className="text-6xl mb-3">{total === 0 ? '📭' : pct >= 70 ? '🎉' : '💪'}</div>
            <h2 className="text-2xl font-bold">
              {total === 0 ? t('session.noWords') : t('session.completed')}
            </h2>
          </div>

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
              <h3 className="text-xs font-medium text-slate-500 uppercase tracking-widest">{t('session.boxFlow')}</h3>

              <div className="overflow-x-auto">
                {/* Row 1: C0 + vertical arrow down to C1 row */}
                {(() => {
                  const adv0 = advanced[0] ?? 0
                  const drop0 = dropped[0] ?? 0
                  const showArrow = adv0 > 0 || drop0 > 0
                  const arrowGreen = adv0 > 0
                  const arrowCount = arrowGreen ? adv0 : drop0
                  const arrowWords = arrowGreen ? (advancedWords[0] ?? []) : (droppedWords[0] ?? [])
                  return (
                    <div className="flex flex-col items-start mb-1">
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg ${BOX_BG[0]} text-slate-900`}>
                        {boxPrefix}0
                      </span>
                      {showArrow && (
                        <div
                          className={`flex flex-col items-center ml-1 leading-tight cursor-default ${arrowGreen ? 'text-green-400' : 'text-red-400'}`}
                          title={arrowWords.join(', ')}
                        >
                          <span className="text-[10px] font-semibold">{arrowCount}</span>
                          <span className="text-base leading-none">↓</span>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Row 2: C1–C6 chain with horizontal arrows and drop badges below */}
                <div className="flex items-start gap-1">
                  {[1, 2, 3, 4, 5, 6].map((box, idx) => {
                    const adv = advanced[box] ?? 0
                    const drop = dropped[box] ?? 0
                    const hasActivity = activeBoxes.includes(box) || adv > 0 || drop > 0
                    return (
                      <div key={box} className="flex items-start gap-1">
                        {/* Box pill + optional drop badge below */}
                        <div className={`flex flex-col items-center gap-0.5 ${!hasActivity ? 'opacity-25' : ''}`}>
                          <span className={`text-xs font-bold px-2 py-1 rounded-lg ${BOX_BG[box] ?? 'bg-slate-600'} text-slate-900`}>
                            {boxPrefix}{box}
                          </span>
                          {drop > 0 && (
                            <div
                              className="flex flex-col items-center leading-tight cursor-default"
                              title={(droppedWords[box] ?? []).join(', ')}
                            >
                              <span className="text-red-400 text-[10px] font-medium">↓{drop}</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-900/60 text-red-300">
                                {boxPrefix}0
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Horizontal advance arrow to next box */}
                        {idx < 5 && (
                          <span
                            className={`text-xs font-medium pt-1 cursor-default ${adv > 0 ? 'text-green-400' : 'text-slate-700'}`}
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
              <div className="flex gap-4 justify-center text-[10px] text-slate-500">
                <span><span className="text-green-400">↓N →N</span> {t('session.advanced')}</span>
                <span><span className="text-red-400">↓N {boxPrefix}0</span> {t('session.droppedToZero', { prefix: boxPrefix })}</span>
              </div>
            </div>
          )}

          <button
            onClick={() => loadReview(selectedBoxes, wordsPerSession, reviewMode, [safeRound1, safeRound2, safeRound3], wordsOnly)}
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

  if (!isPairMode && !word) return null
  if (isPairMode && pairWords.length < 2) return null

  // ── Progress ─────────────────────────────────────────────────────────────────
  const greenPct = progressPct()
  const totalWords = allWords.length
  const errSize = errorQueueSize()
  const errResolved = errorResolvedCount()
  const redPct = errSize > 0
    ? ((errSize - errResolved) / Math.max(totalWords + errSize, 1)) * 100
    : 0

  // Words lists for tooltips
  const wordName = (id: number) => allWords.find((w) => w.user_word_id === id)?.palabra ?? String(id)
  const correctWords = correctWordIds.map((id, i) => `${i + 1}. ${wordName(id)}`)
  const incorrectWords = incorrectWordIds.map((id, i) => `${i + 1}. ${wordName(id)}`)

  const autoAdvanceMs = transitionType === 'auto' ? transitionDelay * 1000 : undefined

  return (
    <div className="p-4 pt-8 min-h-screen flex flex-col">

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
            {results.correct > 0 && (
              <span className="text-green-400 font-medium">✓ {results.correct}</span>
            )}
            {results.incorrect > 0 && (
              <span className="text-red-400 font-medium">✗ {results.incorrect}</span>
            )}
            <span className="text-slate-500">{totalWords - results.correct - results.incorrect}</span>
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
            autoPlay={autoPlayAudio}
            onAnswer={(correct, input) => onSingleAnswer(correct, input)}
          />
        ) : word && exerciseType === 'multiple_choice' ? (
          <MultipleChoiceExercise
            key={word.user_word_id}
            word={word}
            autoPlay={autoPlayAudio}
            onAnswer={(correct, input) => onSingleAnswer(correct, input)}
          />
        ) : word && exerciseType === 'first_letter' ? (
          <FirstLetterExercise
            key={word.user_word_id}
            word={word}
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
