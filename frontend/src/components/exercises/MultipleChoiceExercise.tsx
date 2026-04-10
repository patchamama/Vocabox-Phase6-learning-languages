import { useEffect, useState } from 'react'
import type { ReviewWord } from '../../types'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean, userInput: string) => void
}

export default function MultipleChoiceExercise({ word, onAnswer }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const choices = word.choices ?? [word.significado]

  useEffect(() => {
    setSelected(null)
  }, [word.user_word_id])

  const speak = () => {
    const u = new SpeechSynthesisUtterance(word.palabra)
    u.lang = word.idioma_origen
    speechSynthesis.speak(u)
  }

  const pick = (choice: string) => {
    if (selected) return
    setSelected(choice)
    setTimeout(() => onAnswer(choice === word.significado, choice), 900)
  }

  const choiceClass = (choice: string) => {
    if (!selected) return 'bg-slate-700 hover:bg-slate-600 border-slate-600 cursor-pointer'
    if (choice === word.significado) return 'bg-green-500/20 border-green-500 text-green-200'
    if (choice === selected) return 'bg-red-500/20 border-red-500 text-red-200'
    return 'bg-slate-700 border-slate-600 opacity-40'
  }

  return (
    <div className="space-y-5 animate-slide-up">
      <div className="card text-center">
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">
          {word.idioma_origen} → {word.idioma_destino}
        </p>
        <p className="text-4xl font-bold mb-3">{word.palabra}</p>
        <button
          onClick={speak}
          className="text-2xl text-slate-400 hover:text-blue-400 transition-colors"
          title="Escuchar"
        >
          🔊
        </button>
        {word.tema_nombre && (
          <p className="text-xs text-slate-600 mt-2">{word.tema_nombre}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {choices.map((choice, i) => (
          <button
            key={i}
            onClick={() => pick(choice)}
            className={`px-4 py-2 rounded-xl border-2 font-medium text-sm transition-all duration-200 ${choiceClass(choice)}`}
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  )
}
