import { useEffect, useRef, useState } from 'react'
import type { ReviewWord } from '../../types'
import { langPair } from '../../utils/langFlags'
import { stripAccent } from '../../utils/normalize'
import { assignShortcuts, ShortcutLabel } from '../../utils/shortcutLabel'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean, userInput: string) => void
  autoPlay?: boolean
}

export default function MultipleChoiceExercise({ word, onAnswer, autoPlay = false }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const choices = word.choices ?? [word.significado]
  const shortcuts = assignShortcuts(choices)
  // Reverse map: shortcut char → choice text
  const shortcutToChoice = new Map<string, string>()
  shortcuts.forEach((sc, choice) => { if (sc) shortcutToChoice.set(sc, choice) })

  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const speak = () => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(word.palabra)
    u.lang = word.idioma_origen
    speechSynthesis.speak(u)
  }

  useEffect(() => {
    setSelected(null)
    if (!autoPlay) return
    speechSynthesis.cancel()
    const t = setTimeout(() => speak(), 150)
    return () => { clearTimeout(t); speechSynthesis.cancel() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, autoPlay])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey) return  // let browser handle Alt combos
      if (selectedRef.current) return
      if (e.key.length !== 1) return
      const key = stripAccent(e.key.toLowerCase())
      const choice = shortcutToChoice.get(key)
      if (choice) pick(choice)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, choices.join('|')])

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

      <div className="flex flex-wrap gap-2">
        {choices.map((choice, i) => (
          <button
            key={i}
            onClick={() => pick(choice)}
            className={`px-4 py-2 rounded-xl border-2 font-medium text-sm transition-all duration-200 ${choiceClass(choice)}`}
          >
            <ShortcutLabel text={choice} shortcut={shortcuts.get(choice) ?? ''} />
          </button>
        ))}
      </div>
    </div>
  )
}
