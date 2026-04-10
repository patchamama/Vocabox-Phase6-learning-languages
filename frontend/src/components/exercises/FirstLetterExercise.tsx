/**
 * FirstLetterExercise
 *
 * Shows the source word. Answer has blanks: _ _ _ _ _
 * Below: buttons with initial letters of each word in the answer.
 * Letters include the correct initials + 3-4 random extras.
 *
 * For multi-word answers (e.g. "come back"), the user must pick initials
 * in order: first the initial of "come", then of "back".
 * When all initials are chosen correctly → onAnswer(true).
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReviewWord } from '../../types'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean) => void
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
  const pool = [...initials, ...extras]
  return pool.sort(() => Math.random() - 0.5)
}

export default function FirstLetterExercise({ word, onAnswer }: Props) {
  const target = word.significado

  const initials = useMemo(() => getInitials(target), [target])
  const letterPool = useMemo(() => buildLetterPool(initials), [initials])

  const [chosen, setChosen] = useState<string[]>([])
  const [error, setError] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setChosen([])
    setError(false)
    setDone(false)
  }, [word.user_word_id])

  const targetWords = target.trim().split(/\s+/)

  const pick = (letter: string) => {
    if (done || error) return
    const nextIndex = chosen.length
    if (letter.toLowerCase() === initials[nextIndex]) {
      const next = [...chosen, letter.toLowerCase()]
      setChosen(next)
      if (next.length === initials.length) {
        setDone(true)
        setTimeout(() => onAnswer(true), 700)
      }
    } else {
      setError(true)
      setTimeout(() => {
        setError(false)
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

      {/* Blanks */}
      <div className="card text-center space-y-2">
        <p className="text-xs text-slate-500 uppercase tracking-widest">Letra inicial de cada palabra</p>
        <div className="flex gap-3 justify-center flex-wrap">
          {targetWords.map((w, i) => {
            const filled = chosen[i]
            const isError = error && i === chosen.length
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <span
                  className={`text-2xl font-bold w-9 h-9 flex items-center justify-center rounded-lg border-2 transition-all ${
                    isError
                      ? 'border-red-500 text-red-400 bg-red-500/10'
                      : filled
                      ? 'border-green-500 text-green-400 bg-green-500/10'
                      : 'border-slate-500 text-slate-500'
                  }`}
                >
                  {filled ? filled.toUpperCase() : '_'}
                </span>
                <span className="text-xs text-slate-600">
                  {'_'.repeat(w.length - 1)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Letter buttons */}
      <div className="flex flex-wrap gap-2 justify-center">
        {letterPool.map((letter, i) => (
          <button
            key={i}
            onClick={() => pick(letter)}
            disabled={done}
            className={`w-12 h-12 rounded-xl border-2 text-lg font-bold uppercase transition-all active:scale-90 ${
              done
                ? 'border-slate-700 text-slate-600'
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
