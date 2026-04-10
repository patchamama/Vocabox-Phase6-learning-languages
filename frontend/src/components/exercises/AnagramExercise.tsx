/**
 * AnagramExercise
 *
 * Shows the source word. All letters of the answer (excluding spaces)
 * are shuffled and shown as tappable buttons.
 * The answer slots show exactly N boxes (spaces shown as visual gap, not a slot).
 * Tapping a letter fills the next open slot.
 * Wrong completion → flash red, reset.
 * Correct → onAnswer(true).
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReviewWord } from '../../types'

interface LetterTile {
  id: string
  char: string
  used: boolean
}

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean) => void
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function AnagramExercise({ word, onAnswer }: Props) {
  const target = word.significado

  // Letters without spaces, shuffled
  const initialTiles: LetterTile[] = useMemo(() => {
    const chars = target.replace(/\s/g, '').split('')
    return shuffleArray(chars.map((c, i) => ({ id: `${i}-${c}`, char: c, used: false })))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id])

  const [tiles, setTiles] = useState<LetterTile[]>(initialTiles)
  const [filled, setFilled] = useState<(string | null)[]>([])
  const [filledIds, setFilledIds] = useState<(string | null)[]>([])
  const [flash, setFlash] = useState<'correct' | 'error' | null>(null)

  // Build slot layout: array of chars+spaces from target
  const layout = useMemo(() => target.split(''), [target])
  // Slots = only non-space chars (indexed)
  const slotCount = useMemo(() => target.replace(/\s/g, '').length, [target])

  useEffect(() => {
    setTiles(initialTiles)
    setFilled(Array(slotCount).fill(null))
    setFilledIds(Array(slotCount).fill(null))
    setFlash(null)
  }, [word.user_word_id, initialTiles, slotCount])

  const nextSlotIndex = filled.findIndex((f) => f === null)

  const pickTile = (tile: LetterTile) => {
    if (tile.used || flash) return
    if (nextSlotIndex === -1) return

    const newFilled = [...filled]
    const newFilledIds = [...filledIds]
    newFilled[nextSlotIndex] = tile.char
    newFilledIds[nextSlotIndex] = tile.id

    const newTiles = tiles.map((t) => t.id === tile.id ? { ...t, used: true } : t)
    setTiles(newTiles)
    setFilled(newFilled)
    setFilledIds(newFilledIds)

    // Check if complete
    if (newFilled.every((f) => f !== null)) {
      const answer = newFilled.join('')
      const correct = answer.toLowerCase() === target.replace(/\s/g, '').toLowerCase()
      setFlash(correct ? 'correct' : 'error')
      setTimeout(() => {
        onAnswer(correct)
        if (!correct) {
          setTiles(initialTiles)
          setFilled(Array(slotCount).fill(null))
          setFilledIds(Array(slotCount).fill(null))
          setFlash(null)
        }
      }, 700)
    }
  }

  // Remove last filled letter (backspace)
  const removeLast = () => {
    if (flash) return
    const lastFilled = [...filled].reverse().findIndex((f) => f !== null)
    if (lastFilled === -1) return
    const idx = filled.length - 1 - lastFilled
    const tileId = filledIds[idx]

    const newFilled = [...filled]
    const newFilledIds = [...filledIds]
    newFilled[idx] = null
    newFilledIds[idx] = null

    const newTiles = tiles.map((t) => t.id === tileId ? { ...t, used: false } : t)
    setTiles(newTiles)
    setFilled(newFilled)
    setFilledIds(newFilledIds)
  }

  // Render answer slots following the layout (with spaces as visual gap)
  let slotIdx = 0
  const answerDisplay = layout.map((char, i) => {
    if (char === ' ') {
      return <span key={`sp-${i}`} className="w-3" />
    }
    const currentSlot = slotIdx
    const value = filled[currentSlot]
    slotIdx++
    const isNext = currentSlot === nextSlotIndex

    let boxClass = 'border-slate-500 text-slate-400'
    if (flash === 'correct') boxClass = 'border-green-500 text-green-400 bg-green-500/10'
    else if (flash === 'error') boxClass = 'border-red-500 text-red-400 bg-red-500/10'
    else if (value) boxClass = 'border-blue-400 text-white bg-blue-500/10'
    else if (isNext) boxClass = 'border-slate-400 text-slate-400 animate-pulse'

    return (
      <span
        key={`slot-${currentSlot}`}
        className={`inline-flex items-center justify-center w-8 h-10 rounded-lg border-2 text-lg font-bold uppercase transition-all duration-200 ${boxClass}`}
      >
        {value ?? ''}
      </span>
    )
  })

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Source */}
      <div className="card text-center">
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">
          {word.idioma_origen} → {word.idioma_destino}
        </p>
        <p className="text-4xl font-bold">{word.palabra}</p>
      </div>

      {/* Answer slots */}
      <div className="card">
        <p className="text-xs text-slate-500 uppercase tracking-widest text-center mb-3">
          Ordená las letras
        </p>
        <div className="flex flex-wrap gap-1.5 justify-center items-center">
          {answerDisplay}
        </div>
        {nextSlotIndex > 0 && (
          <button
            onClick={removeLast}
            className="mt-3 w-full text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            ← Borrar última
          </button>
        )}
      </div>

      {/* Letter tiles */}
      <div className="flex flex-wrap gap-2 justify-center">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            onClick={() => pickTile(tile)}
            disabled={tile.used || !!flash}
            className={`w-11 h-11 rounded-xl border-2 text-lg font-bold uppercase transition-all duration-150 active:scale-90 ${
              tile.used
                ? 'border-slate-700 text-slate-700 bg-slate-800'
                : 'border-slate-500 bg-slate-700 text-white hover:border-blue-400 hover:bg-slate-600'
            }`}
          >
            {tile.used ? '' : tile.char.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
