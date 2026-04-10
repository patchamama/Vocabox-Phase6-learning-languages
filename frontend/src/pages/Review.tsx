import { useEffect, useState } from 'react'
import MultipleChoiceExercise from '../components/exercises/MultipleChoiceExercise'
import WriteExercise from '../components/exercises/WriteExercise'
import { useReviewStore } from '../stores/reviewStore'

interface LastEntry {
  input: string
  correctAnswer: string
  wasCorrect: boolean
}

export default function Review() {
  const {
    words,
    currentIndex,
    results,
    isLoading,
    isFinished,
    loadReview,
    submitAnswer,
    nextWord,
    reset,
  } = useReviewStore()

  const [lastEntry, setLastEntry] = useState<LastEntry | null>(null)

  useEffect(() => {
    loadReview()
    return () => { reset() }
  }, [loadReview, reset])

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
          <button onClick={loadReview} className="btn-primary w-full">
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
    await submitAnswer(current.user_word_id, correct)
    nextWord()
  }

  // Phrases (spaces in palabra) always use multiple choice even if backend said write
  const isPhrase = current.palabra.includes(' ')
  const exerciseType = isPhrase ? 'multiple_choice' : current.exercise_type

  const progressPct = ((currentIndex + 1) / words.length) * 100

  return (
    <div className="p-4 pt-8 min-h-screen flex flex-col">
      {/* Progress bar */}
      <div className="mb-6">
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
          </div>
        </div>
        <div className="bg-slate-700 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex-1">
        {exerciseType === 'write' ? (
          <WriteExercise word={current} onAnswer={handleAnswer} />
        ) : (
          <MultipleChoiceExercise word={current} onAnswer={handleAnswer} />
        )}
      </div>

      {/* Last entry recap — shown while reviewing the next word */}
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
