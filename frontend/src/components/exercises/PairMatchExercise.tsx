/**
 * PairMatchExercise
 *
 * Shows a mixed grid of words + meanings. User taps one, then another.
 * If they match → both disappear (correct pair).
 * If they don't  → second card flashes red briefly, then deselects.
 * When all pairs are gone → onComplete(errors) is called.
 *
 * The component receives a batch of ReviewWords (2-6 pairs work best).
 */
import { useEffect, useRef, useState } from 'react'
import type { ReviewWord } from '../../types'

interface Tile {
  id: string        // e.g. "word-3" | "sig-3"
  wordId: number
  text: string
  side: 'word' | 'sig'
}

interface Props {
  words: ReviewWord[]
  onComplete: (incorrectWordIds: number[]) => void
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function PairMatchExercise({ words, onComplete }: Props) {
  const [tiles, setTiles] = useState<Tile[]>([])
  const [selected, setSelected] = useState<Tile | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const errorCount = useRef<Record<number, number>>({})

  useEffect(() => {
    const raw: Tile[] = words.flatMap((w) => [
      { id: `word-${w.word_id}`, wordId: w.word_id, text: w.palabra, side: 'word' as const },
      { id: `sig-${w.word_id}`, wordId: w.word_id, text: w.significado, side: 'sig' as const },
    ])
    setTiles(shuffle(raw))
    setSelected(null)
    setErrorId(null)
    setMatched(new Set())
    errorCount.current = {}
  }, [words])

  const handleTap = (tile: Tile) => {
    if (matched.has(tile.id)) return
    if (errorId) return  // wait for error animation
    if (selected?.id === tile.id) {
      setSelected(null)
      return
    }

    if (!selected) {
      setSelected(tile)
      return
    }

    // Check match: same wordId, different side
    if (selected.wordId === tile.wordId && selected.side !== tile.side) {
      const next = new Set(matched)
      next.add(selected.id)
      next.add(tile.id)
      setMatched(next)
      setSelected(null)

      if (next.size === tiles.length) {
        const incorrect = Object.entries(errorCount.current)
          .filter(([, c]) => c > 0)
          .map(([id]) => Number(id))
        onComplete(incorrect)
      }
    } else {
      // Error
      errorCount.current[selected.wordId] = (errorCount.current[selected.wordId] || 0) + 1
      errorCount.current[tile.wordId] = (errorCount.current[tile.wordId] || 0) + 1
      setErrorId(tile.id)
      setTimeout(() => {
        setErrorId(null)
        setSelected(null)
      }, 800)
    }
  }

  const tileClass = (tile: Tile) => {
    if (matched.has(tile.id)) return 'opacity-0 pointer-events-none scale-90'
    if (errorId === tile.id) return 'border-red-500 bg-red-500/20 text-red-300 scale-95'
    if (selected?.id === tile.id) return 'border-blue-400 bg-blue-500/20 text-white scale-95'
    return 'border-slate-600 bg-slate-700 text-slate-200 hover:border-slate-400 hover:bg-slate-600 active:scale-95'
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <p className="text-xs text-slate-500 text-center uppercase tracking-widest">
        Pareo · seleccioná palabra y traducción
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            onClick={() => handleTap(tile)}
            className={`px-4 py-2.5 rounded-xl border-2 font-medium text-sm transition-all duration-200 ${tileClass(tile)}`}
          >
            {tile.text}
          </button>
        ))}
      </div>
    </div>
  )
}
