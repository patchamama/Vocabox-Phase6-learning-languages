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

export default function Review() {
  const [searchParams] = useSearchParams()
  const { reviewMode, wordsPerSession } = useSettingsStore()

  const {
    pairBatch,
    results,
    isLoading,
    isFinished,
    inErrorPhase,
    errorQueue,
    loadReview,
    handleSingleAnswer,
    handlePairMatchComplete,
    patchWord,
    reset,
    currentWord,
    currentExerciseType,
    progressPct,
    errorQueueSize,
    errorResolvedCount,
  } = useReviewStore()

  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ palabra: '', significado: '' })
  const [isSaving, setIsSaving] = useState(false)
  const editPalabraRef = useRef<HTMLInputElement>(null)

  const boxesParam = searchParams.get('boxes')
  const selectedBoxes = boxesParam
    ? boxesParam.split(',').map(Number).filter((n) => !isNaN(n))
    : undefined

  useEffect(() => {
    loadReview(selectedBoxes, wordsPerSession, reviewMode)
    return () => { reset() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            onClick={() => loadReview(selectedBoxes, wordsPerSession, reviewMode)}
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
  const isPairMode = pairBatch.length > 0

  if (!isPairMode && !word) return null

  // ── Progress bar ─────────────────────────────────────────────────────────────
  const greenPct = progressPct()
  const totalItems = useReviewStore.getState().queue.length
  const errSize = errorQueueSize()
  const errResolved = errorResolvedCount()
  const redPct = errSize > 0 ? ((errSize - errResolved) / Math.max(totalItems + errSize, 1)) * 100 : 0

  // ── Edit handlers ────────────────────────────────────────────────────────────
  const openEdit = () => {
    if (!word) return
    setEditForm({ palabra: word.palabra, significado: word.significado })
    setIsEditing(true)
    setTimeout(() => editPalabraRef.current?.focus(), 50)
  }

  const handleSaveEdit = async () => {
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

  const EXERCISE_LABEL: Record<string, string> = {
    multiple_choice: 'Opción múltiple',
    write: 'Escribir',
    pair_match: 'Pareo',
    first_letter: 'Letra inicial',
    anagram: 'Anagrama',
  }

  return (
    <div className="p-4 pt-8 min-h-screen flex flex-col">

      {/* ── Progress bar ── */}
      <div className="mb-4">
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="text-slate-400">
            {inErrorPhase ? '🔁 Repaso de errores' : exerciseType ? EXERCISE_LABEL[exerciseType] : ''}
          </span>
          <div className="flex items-center gap-3">
            {results.correct > 0 && (
              <span className="text-blue-400 font-medium">✓ {results.correct}</span>
            )}
            {results.incorrect > 0 && (
              <span className="text-red-400 font-medium">✗ {results.incorrect}</span>
            )}
            {!isPairMode && word && (
              <span className="text-slate-400">Caja {word.box_level}</span>
            )}
            {!isPairMode && (
              <button
                onClick={isEditing ? () => setIsEditing(false) : openEdit}
                title={isEditing ? 'Cerrar edición' : 'Editar palabra'}
                className={`px-1.5 transition-colors ${
                  isEditing ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                ✎
              </button>
            )}
          </div>
        </div>

        {/* Composite bar: green (done) + red (errors pending) */}
        <div className="bg-slate-700 rounded-full h-2 overflow-hidden flex">
          <div
            className="bg-blue-500 h-2 transition-all duration-300"
            style={{ width: `${greenPct}%` }}
          />
          {errSize > 0 && (
            <div
              className="bg-red-500/70 h-2 transition-all duration-300"
              style={{ width: `${redPct}%` }}
            />
          )}
        </div>
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
            key={pairBatch.map((w) => w.user_word_id).join('-')}
            words={pairBatch}
            onComplete={handlePairMatchComplete}
          />
        ) : word && exerciseType === 'write' ? (
          <WriteExercise
            key={word.user_word_id}
            word={word}
            onAnswer={(correct, input) => handleSingleAnswer(word.user_word_id, correct)}
          />
        ) : word && exerciseType === 'multiple_choice' ? (
          <MultipleChoiceExercise
            key={word.user_word_id}
            word={word}
            onAnswer={(correct, input) => handleSingleAnswer(word.user_word_id, correct)}
          />
        ) : word && exerciseType === 'first_letter' ? (
          <FirstLetterExercise
            key={word.user_word_id}
            word={word}
            onAnswer={(correct) => handleSingleAnswer(word.user_word_id, correct)}
          />
        ) : word && exerciseType === 'anagram' ? (
          <AnagramExercise
            key={word.user_word_id}
            word={word}
            onAnswer={(correct) => handleSingleAnswer(word.user_word_id, correct)}
          />
        ) : null}
      </div>
    </div>
  )
}
