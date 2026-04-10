import { useEffect } from 'react'
import MultipleChoiceExercise from '../components/exercises/MultipleChoiceExercise'
import WriteExercise from '../components/exercises/WriteExercise'
import { useReviewStore } from '../stores/reviewStore'

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

  const handleAnswer = async (correct: boolean) => {
    await submitAnswer(current.user_word_id, correct)
    nextWord()
  }

  return (
    <div className="p-4 pt-8 min-h-screen flex flex-col">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>{currentIndex + 1} / {words.length}</span>
          <span>Caja {current.box_level}</span>
        </div>
        <div className="bg-slate-700 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1">
        {current.exercise_type === 'write' ? (
          <WriteExercise word={current} onAnswer={handleAnswer} />
        ) : (
          <MultipleChoiceExercise word={current} onAnswer={handleAnswer} />
        )}
      </div>
    </div>
  )
}
