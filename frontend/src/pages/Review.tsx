import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MultipleChoiceExercise from '../components/exercises/MultipleChoiceExercise'
import WriteExercise from '../components/exercises/WriteExercise'
import { wordsApi } from '../api/client'
import { useReviewStore } from '../stores/reviewStore'

interface LastEntry {
  input: string
  correctAnswer: string
  wasCorrect: boolean
}

export default function Review() {
  const [searchParams] = useSearchParams()

  const {
    words,
    currentIndex,
    results,
    isLoading,
    isFinished,
    loadReview,
    submitAnswer,
    nextWord,
    patchWord,
    reset,
  } = useReviewStore()

  const [lastEntry, setLastEntry] = useState<LastEntry | null>(null)

  // Inline edit state
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ palabra: '', significado: '' })
  const [isSaving, setIsSaving] = useState(false)
  const editPalabraRef = useRef<HTMLInputElement>(null)

  // Read selected boxes from URL (?boxes=0,1,2,3)
  const boxesParam = searchParams.get('boxes')
  const selectedBoxes = boxesParam
    ? boxesParam.split(',').map(Number).filter((n) => !isNaN(n))
    : undefined

  useEffect(() => {
    loadReview(selectedBoxes)
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
          <button onClick={() => loadReview(selectedBoxes)} className="btn-primary w-full">
            {total === 0 ? 'Actualizar' : 'Nueva sesión'}
          </button>
        </div>
      </div>
    )
  }

  const current = words[currentIndex]
  if (!current) return null

  const handleAnswer = async (correct: boolean, userInput: string = '') => {
    setLastEntry({ input: userInput, correctAnswer: current.significado, wasCorrect: correct })
    setIsEditing(false)
    await submitAnswer(current.user_word_id, correct)
    nextWord()
  }

  const openEdit = () => {
    setEditForm({ palabra: current.palabra, significado: current.significado })
    setIsEditing(true)
    setTimeout(() => editPalabraRef.current?.focus(), 50)
  }

  const handleSaveEdit = async () => {
    const p = editForm.palabra.trim()
    const s = editForm.significado.trim()
    if (!p || !s) return
    setIsSaving(true)
    try {
      await wordsApi.update(current.word_id, { palabra: p, significado: s })
      patchWord(current.user_word_id, { palabra: p, significado: s })
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  // Phrases always use multiple choice even if backend said write
  const isPhrase = current.palabra.includes(' ')
  const exerciseType = isPhrase ? 'multiple_choice' : current.exercise_type
  const progressPct = ((currentIndex + 1) / words.length) * 100

  return (
    <div className="p-4 pt-8 min-h-screen flex flex-col">

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="text-slate-400">{currentIndex + 1} / {words.length}</span>
          <div className="flex items-center gap-3">
            {results.correct > 0 && (
              <span className="text-blue-400 font-medium">✓ {results.correct}</span>
            )}
            {results.incorrect > 0 && (
              <span className="text-red-400 font-medium">✗ {results.incorrect}</span>
            )}
            <span className="text-slate-400">Caja {current.box_level}</span>
            <button
              onClick={isEditing ? () => setIsEditing(false) : openEdit}
              title={isEditing ? 'Cerrar edición' : 'Editar palabra'}
              className={`px-1.5 transition-colors ${
                isEditing ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              ✎
            </button>
          </div>
        </div>
        <div className="bg-slate-700 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Inline edit panel */}
      {isEditing && (
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
            <button
              onClick={() => setIsEditing(false)}
              className="btn-secondary flex-1 py-2 text-sm"
            >
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

      <div className="flex-1">
        {exerciseType === 'write' ? (
          <WriteExercise word={current} onAnswer={handleAnswer} />
        ) : (
          <MultipleChoiceExercise word={current} onAnswer={handleAnswer} />
        )}
      </div>

      {/* Last entry recap */}
      {lastEntry && (
        <div className="mt-4 pt-3 border-t border-slate-700/60 text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            Anterior:{' '}
            <span className={lastEntry.wasCorrect ? 'text-blue-400' : 'text-red-400'}>
              {lastEntry.input || '—'}
            </span>
          </span>
          <span>
            Correcta:{' '}
            <span className="text-green-400">{lastEntry.correctAnswer}</span>
          </span>
        </div>
      )}
    </div>
  )
}
