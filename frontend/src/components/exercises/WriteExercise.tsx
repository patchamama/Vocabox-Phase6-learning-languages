import { FormEvent, useEffect, useRef, useState } from 'react'
import type { ReviewWord } from '../../types'
import { langPair } from '../../utils/langFlags'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean, userInput: string) => void
  autoPlay?: boolean
}

export default function WriteExercise({ word, onAnswer, autoPlay = false }: Props) {
  const [input, setInput] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const choices = word.choices ?? null

  const speak = () => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(word.palabra)
    u.lang = word.idioma_origen
    speechSynthesis.speak(u)
  }

  useEffect(() => {
    setInput('')
    setRevealed(false)
    setIsCorrect(null)
    setShowOptions(false)
    setSelectedChoice(null)
    inputRef.current?.focus()

    if (!autoPlay) return
    speechSynthesis.cancel()
    const t = setTimeout(() => speak(), 150)
    return () => { clearTimeout(t); speechSynthesis.cancel() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, autoPlay])

  const check = (e: FormEvent) => {
    e.preventDefault()
    const correct = input.trim().toLowerCase() === word.significado.trim().toLowerCase()
    setIsCorrect(correct)
    setRevealed(true)
  }

  // Options mode: pick a choice, show result, auto-advance
  const pickChoice = (choice: string) => {
    if (selectedChoice) return
    const correct = choice === word.significado
    setSelectedChoice(choice)
    setIsCorrect(correct)
    setRevealed(true)
    setTimeout(() => onAnswer(correct, choice), 900)
  }

  const choiceClass = (choice: string) => {
    if (!selectedChoice) return 'bg-slate-700 hover:bg-slate-600 border-slate-600 cursor-pointer'
    if (choice === word.significado) return 'bg-green-500/20 border-green-500 text-green-200'
    if (choice === selectedChoice) return 'bg-red-500/20 border-red-500 text-red-200'
    return 'bg-slate-700 border-slate-600 opacity-40'
  }

  return (
    <div className="space-y-5 animate-slide-up">
      <div className="card text-center">
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">
          {langPair(word.idioma_origen, word.idioma_destino)}
        </p>
        <p className="font-bold mb-3 break-words hyphens-auto leading-tight
          text-4xl [word-break:break-word]">{word.palabra}</p>
        <button
          onClick={speak}
          className="text-2xl text-slate-400 hover:text-blue-400 transition-colors"
          title="Escuchar"
        >
          🔊
        </button>
        {word.tema_nombre && (
          <span
            className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium text-white"
            style={{ backgroundColor: word.tema_color ?? '#64748b' }}
          >
            {word.tema_nombre}
          </span>
        )}
      </div>

      {/* Options mode */}
      {showOptions && choices ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((choice, i) => (
            <button
              key={i}
              onClick={() => pickChoice(choice)}
              className={`px-4 py-2 rounded-xl border-2 font-medium text-sm transition-all duration-200 ${choiceClass(choice)}`}
            >
              {choice}
            </button>
          ))}
          {!revealed && (
            <button
              type="button"
              onClick={() => { setShowOptions(false); setTimeout(() => inputRef.current?.focus(), 50) }}
              className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors pt-1"
            >
              Escribir respuesta
            </button>
          )}
        </div>
      ) : !revealed ? (
        /* Write mode */
        <form onSubmit={check} className="space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="input text-lg text-center"
            placeholder={`✍ ${langPair(word.idioma_origen, word.idioma_destino)}`}
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
          {choices && (
            <button
              type="button"
              onClick={() => setShowOptions(true)}
              className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors pt-1"
            >
              Ver opciones
            </button>
          )}
        </form>
      ) : (
        /* Revealed — write mode result */
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
              onClick={() => onAnswer(false, input.trim())}
              className="flex-1 btn-secondary border border-red-500/50 text-red-300"
            >
              Marcar mal
            </button>
            <button
              onClick={() => onAnswer(true, input.trim())}
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
