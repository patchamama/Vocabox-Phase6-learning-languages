/**
 * FirstLetterExercise
 *
 * Shows the source word. Answer slots show each target word with a box for its initial letter.
 * On correct pick: fills the box AND reveals the full word.
 * On error: flash red, reset.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReviewWord } from '../../types'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean) => void
  /** ms to wait before calling onAnswer(true). 0 = caller handles timing */
  autoAdvanceMs?: number
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

function getInitials(text: string): string[] {
  return text.trim().split(/\s+/).map((w) => w[0].toLowerCase())
}

function buildLetterPool(initials: string[]): string[] {
  const needed = new Set(initials)
  const extras: string[] = []
  const shuffled = [...ALPHABET].sort(() => Math.random() - 0.5)
  for (const ch of shuffled) {
    if (!needed.has(ch) && extras.length < 4) extras.push(ch)
  }
  return [...initials, ...extras].sort(() => Math.random() - 0.5)
}

export default function FirstLetterExercise({ word, onAnswer, autoAdvanceMs }: Props) {
  const target = word.significado
  const targetWords = useMemo(() => target.trim().split(/\s+/), [target])
  const initials = useMemo(() => getInitials(target), [target])
  const letterPool = useMemo(() => buildLetterPool(initials), [initials])

  const [chosen, setChosen] = useState<string[]>([])
  const [flash, setFlash] = useState<'error' | 'correct' | null>(null)

  useEffect(() => {
    setChosen([])
    setFlash(null)
  }, [word.user_word_id])

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ch = e.key.toLowerCase()
      if (ch.length !== 1 || !/[a-záéíóúüàèìòùñäëïöüß]/.test(ch)) return
      pick(ch)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, chosen, flash])

  const pick = (letter: string) => {
    if (flash) return
    const nextIndex = chosen.length
    if (letter.toLowerCase() === initials[nextIndex]) {
      const next = [...chosen, letter.toLowerCase()]
      setChosen(next)
      if (next.length === initials.length) {
        setFlash('correct')
        if (autoAdvanceMs !== undefined) {
          setTimeout(() => onAnswer(true), autoAdvanceMs)
        } else {
          // caller controls when to advance (button mode)
          setTimeout(() => onAnswer(true), 300)
        }
      }
    } else {
      setFlash('error')
      setTimeout(() => {
        setFlash(null)
        setChosen([])
      }, 700)
      setTimeout(() => onAnswer(false), 800)
    }
  }

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Source word */}
      <div className="card text-center">
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">
          {word.idioma_origen} → {word.idioma_destino}
        </p>
        <p className="text-4xl font-bold">{word.palabra}</p>
      </div>

      {/* Word slots */}
      <div className="card text-center space-y-3">
        <p className="text-xs text-slate-500 uppercase tracking-widest">
          Letra inicial de cada palabra
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          {targetWords.map((w, i) => {
            const filled = chosen[i]
            const isError = flash === 'error' && i === chosen.length
            const isCorrect = flash === 'correct' || (!!filled && i < chosen.length)

            return (
              <div key={i} className="flex flex-col items-center gap-1">
                {/* Initial letter box */}
                <span
                  className={`text-xl font-bold w-10 h-10 flex items-center justify-center rounded-lg border-2 transition-all duration-200 ${
                    isError
                      ? 'border-red-500 text-red-400 bg-red-500/10'
                      : isCorrect
                      ? 'border-green-500 text-green-400 bg-green-500/10'
                      : 'border-slate-500 text-slate-400'
                  }`}
                >
                  {filled ? filled.toUpperCase() : '_'}
                </span>
                {/* Full word — shown when filled */}
                <span
                  className={`text-sm font-medium transition-all duration-300 ${
                    filled
                      ? flash === 'correct'
                        ? 'text-green-400 opacity-100'
                        : 'text-slate-300 opacity-100'
                      : 'text-slate-700 opacity-0 select-none'
                  }`}
                >
                  {w}
                </span>
              </div>
            )
          })}
        </div>

        {flash === 'correct' && (
          <p className="text-green-400 text-sm font-medium animate-slide-up">
            ✓ {target}
          </p>
        )}
      </div>

      {/* Letter buttons */}
      <div className="flex flex-wrap gap-2 justify-center">
        {letterPool.map((letter, i) => (
          <button
            key={i}
            onClick={() => pick(letter)}
            disabled={flash === 'correct'}
            className={`w-12 h-12 rounded-xl border-2 text-lg font-bold uppercase transition-all active:scale-90 ${
              flash === 'correct'
                ? 'border-slate-700 text-slate-600 bg-slate-800'
                : 'border-slate-500 bg-slate-700 text-white hover:border-blue-400 hover:bg-slate-600'
            }`}
          >
            {letter.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
