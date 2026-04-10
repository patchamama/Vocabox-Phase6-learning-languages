import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { wordsApi } from '../api/client'
import AnagramExercise from '../components/exercises/AnagramExercise'
import FirstLetterExercise from '../components/exercises/FirstLetterExercise'
import MultipleChoiceExercise from '../components/exercises/MultipleChoiceExercise'
import PairMatchExercise from '../components/exercises/PairMatchExercise'
import WriteExercise from '../components/exercises/WriteExercise'
import { useReviewStore } from '../stores/reviewStore'
import { useSettingsStore } from '../stores/settingsStore'

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

const EXERCISE_LABEL: Record<string, string> = {
  multiple_choice: 'Opción múltiple',
  write: 'Escribir',
  pair_match: 'Pareo',
  first_letter: 'Letra inicial',
  anagram: 'Anagrama',
}

export default function Review() {
  const [searchParams] = useSearchParams()
  const {
    reviewMode, wordsPerSession, transitionDelay, transitionType,
    safeRound1, safeRound2, safeRound3, autoPlayAudio, wordsOnly,
  } = useSettingsStore()

  const {
    results,
    isLoading,
    isFinished,
    inErrorPhase,
    errorQueue,
    currentRound,
    totalRounds,
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
  const [editForm, setEditForm] = useState({ palabra: '', significado: '' })
  const [isSaving, setIsSaving] = useState(false)
  const editPalabraRef = useRef<HTMLInputElement>(null)

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

  const confirmAdvance = () => {
    if (!pendingAction) return
    if (timerRef.current) clearTimeout(timerRef.current)
    setPendingAdvance(false)
    const fn = pendingAction
    setPendingAction(null)
    fn()
  }

  // ── Answer handlers ──────────────────────────────────────────────────────────
  const onSingleAnswer = (correct: boolean, userInput: string = '') => {
    const word = currentWord()
    if (!word) return
    const capturedId = word.user_word_id
    setLastEntry({ question: word.palabra, input: userInput, correctAnswer: word.significado, wasCorrect: correct })
    setIsEditing(false)
    scheduleAdvance(() => handleSingleAnswer(capturedId, correct))
  }

  // ── Edit handlers ────────────────────────────────────────────────────────────
  const openEdit = () => {
    const word = currentWord()
    if (!word) return
    setEditForm({ palabra: word.palabra, significado: word.significado })
    setIsEditing(true)
    setTimeout(() => editPalabraRef.current?.focus(), 50)
  }

  const handleSaveEdit = async () => {
    const word = currentWord()
    if (!word) return
    const p = editForm.palabra.trim()
    const s = editForm.significado.trim()
    if (!p || !s) return
    setIsSaving(true)
    try {
      await wordsApi.update(word.word_id, { palabra: p, significado: s })
      patchWord(word.user_word_id, { palabra: p, significado: s })
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
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
    const total = results.correct + results.incorrect
    const pct = total > 0 ? Math.round((results.correct / total) * 100) : 0
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="card max-w-sm w-full text-center animate-slide-up">
          <div className="text-6xl mb-4">{total === 0 ? '📭' : pct >= 70 ? '🎉' : '💪'}</div>
          <h2 className="text-2xl font-bold mb-2">
            {total === 0 ? 'Sin palabras pendientes' : 'Sesión completada'}
          </h2>
          {total > 0 && (
            <>
              <p className="text-slate-400 mb-5">Precisión: {pct}%</p>
              <div className="flex justify-center gap-8 mb-6">
                <div>
                  <div className="text-3xl font-bold text-green-400">{results.correct}</div>
                  <div className="text-xs text-slate-400 mt-1">Correctas</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-red-400">{results.incorrect}</div>
                  <div className="text-xs text-slate-400 mt-1">Incorrectas</div>
                </div>
              </div>
            </>
          )}
          <button
            onClick={() => loadReview(selectedBoxes, wordsPerSession, reviewMode, [safeRound1, safeRound2, safeRound3], wordsOnly)}
            className="btn-primary w-full"
          >
            {total === 0 ? 'Actualizar' : 'Nueva sesión'}
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
  const totalWords = useReviewStore.getState().allWords.length
  const errSize = errorQueueSize()
  const errResolved = errorResolvedCount()
  const redPct = errSize > 0
    ? ((errSize - errResolved) / Math.max(totalWords + errSize, 1)) * 100
    : 0

  const autoAdvanceMs = transitionType === 'auto' ? transitionDelay * 1000 : undefined

  return (
    <div className="p-4 pt-8 min-h-screen flex flex-col">

      {/* ── Progress bar ── */}
      <div className="mb-4">
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="text-slate-400 flex items-center gap-1.5">
            {reviewMode === 'safe' && !inErrorPhase && (
              <span className="text-xs bg-slate-600 text-slate-300 px-1.5 py-0.5 rounded-full font-medium">
                R{currentRound + 1}/{totalRounds}
              </span>
            )}
            {inErrorPhase
              ? '🔁 Repaso de errores'
              : exerciseType ? EXERCISE_LABEL[exerciseType] : ''}
          </span>
          <div className="flex items-center gap-2">
            {results.correct > 0 && (
              <span className="text-blue-400 font-medium">✓ {results.correct}</span>
            )}
            {results.incorrect > 0 && (
              <span className="text-red-400 font-medium">✗ {results.incorrect}</span>
            )}
            {!isPairMode && word && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold text-slate-900 ${BOX_BG[word.box_level] ?? 'bg-slate-500'}`}
              >
                C{word.box_level}
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
                onClick={isEditing ? () => setIsEditing(false) : openEdit}
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

        {/* Composite progress bar */}
        <div className="bg-slate-700 rounded-full h-2 overflow-hidden flex">
          <div
            className="bg-blue-500 h-2 transition-all duration-500"
            style={{ width: `${greenPct}%` }}
          />
          {errSize > 0 && (
            <div
              className="bg-red-500/70 h-2 transition-all duration-500"
              style={{ width: `${redPct}%` }}
            />
          )}
        </div>

        {/* Error queue indicator */}
        {errSize > 0 && (
          <p className="text-xs text-red-400/70 mt-0.5 text-right">
            {errSize - errResolved} pendiente{errSize - errResolved !== 1 ? 's' : ''} de repasar
          </p>
        )}
      </div>

      {/* ── Inline edit panel ── */}
      {isEditing && word && (
        <div className="card mb-4 space-y-3 animate-slide-up border-blue-500/30">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">
            Editar palabra
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              ref={editPalabraRef}
              className="input text-sm"
              placeholder="Palabra"
              value={editForm.palabra}
              onChange={(e) => setEditForm((f) => ({ ...f, palabra: e.target.value }))}
            />
            <input
              className="input text-sm"
              placeholder="Significado"
              value={editForm.significado}
              onChange={(e) => setEditForm((f) => ({ ...f, significado: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setIsEditing(false)} className="btn-secondary flex-1 py-2 text-sm">
              Cancelar
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={isSaving || !editForm.palabra.trim() || !editForm.significado.trim()}
              className="btn-primary flex-1 py-2 text-sm"
            >
              {isSaving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Exercise ── */}
      <div className="flex-1">
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
                  {lastEntry.wasCorrect ? '✓ Correcto' : '✗ Incorrecto'}
                </p>
                <p className="text-slate-500 text-xs mb-1">{lastEntry.question}</p>
                {!lastEntry.wasCorrect && lastEntry.input && (
                  <p className="text-sm text-slate-400 mb-1">Tu respuesta: {lastEntry.input}</p>
                )}
                <p className="text-slate-200">{lastEntry.correctAnswer}</p>
              </div>
            )}
            {transitionType === 'button' ? (
              <button onClick={confirmAdvance} className="btn-primary w-full">
                Continuar →
              </button>
            ) : (
              <div className="text-center text-xs text-slate-500">
                Continuando en {transitionDelay}s…
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

      {/* ── Último resultado (solo cuando NO está en pendingAdvance) ── */}
      {lastEntry && !pendingAdvance && (
        <div className="mt-4 pt-3 border-t border-slate-700/60 text-xs text-slate-500 flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
          <span className="text-slate-600">{lastEntry.question}</span>
          <span className="text-slate-700">·</span>
          <span className={lastEntry.wasCorrect ? 'text-green-400' : 'text-red-400'}>
            {lastEntry.input || '—'}
          </span>
          <span className="text-slate-700">→</span>
          <span className="text-slate-400">{lastEntry.correctAnswer}</span>
        </div>
      )}
    </div>
  )
}
