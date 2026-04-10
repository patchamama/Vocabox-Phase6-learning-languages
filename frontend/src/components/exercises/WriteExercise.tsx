import { FormEvent, useEffect, useRef, useState } from 'react'
import type { ReviewWord } from '../../types'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean) => void
}

export default function WriteExercise({ word, onAnswer }: Props) {
  const [input, setInput] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setInput('')
    setRevealed(false)
    setIsCorrect(null)
    inputRef.current?.focus()
  }, [word.user_word_id])

  const speak = () => {
    const u = new SpeechSynthesisUtterance(word.palabra)
    u.lang = word.idioma_origen
    speechSynthesis.speak(u)
  }

  const check = (e: FormEvent) => {
    e.preventDefault()
    const correct =
      input.trim().toLowerCase() === word.significado.trim().toLowerCase()
    setIsCorrect(correct)
    setRevealed(true)
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
      </div>

      {!revealed ? (
        <form onSubmit={check} className="space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="input text-lg text-center"
            placeholder={`Escribe en ${word.idioma_destino}`}
            autoComplete="off"
            autoCorrect="off"
          />
          <button type="submit" className="btn-primary w-full" disabled={!input.trim()}>
            Comprobar
          </button>
          <button
            type="button"
            onClick={() => { setIsCorrect(false); setRevealed(true) }}
            className="btn-secondary w-full text-sm"
          >
            No sé
          </button>
        </form>
      ) : (
        <div className="space-y-4 animate-slide-up">
          <div
            className={`card text-center border-2 ${
              isCorrect ? 'border-green-500' : 'border-red-500'
            }`}
          >
            {!isCorrect && input && (
              <p className="text-red-400 text-sm mb-1">Tu respuesta: {input}</p>
            )}
            <p className="text-xl font-semibold">{word.significado}</p>
            <p
              className={`text-sm font-medium mt-2 ${
                isCorrect ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {isCorrect ? '✓ Correcto' : '✗ Incorrecto'}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => onAnswer(false)}
              className="flex-1 btn-secondary border border-red-500/50 text-red-300"
            >
              Marcar mal
            </button>
            <button
              onClick={() => onAnswer(true)}
              className="flex-1 btn-primary bg-green-600 hover:bg-green-700"
            >
              Marcar bien
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
