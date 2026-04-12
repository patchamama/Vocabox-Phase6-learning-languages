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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReviewWord } from '../../types'
import { stripAccent } from '../../utils/normalize'
import { ShortcutLabel } from '../../utils/shortcutLabel'

// Assigns shortcuts keyed by tile.id (not tile.text, since texts may repeat across sides)
function assignShortcuts(tiles: { id: string; text: string }[]): Map<string, string> {
  const used = new Set<string>()
  const result = new Map<string, string>()
  for (const tile of tiles) {
    let assigned = ''
    for (const ch of tile.text) {
      const key = stripAccent(ch.toLowerCase())
      if (key.length === 1 && /[a-z0-9]/.test(key) && !used.has(key)) {
        used.add(key)
        assigned = key
        break
      }
    }
    result.set(tile.id, assigned)
  }
  return result
}

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
  const { t } = useTranslation()
  const [tiles, setTiles] = useState<Tile[]>([])
  const [selected, setSelected] = useState<Tile | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const errorCount = useRef<Record<number, number>>({})

  // Refs for keyboard handler (avoid stale closures)
  const tilesRef = useRef(tiles)
  const selectedRef = useRef(selected)
  const matchedRef = useRef(matched)
  const errorIdRef = useRef(errorId)
  tilesRef.current = tiles
  selectedRef.current = selected
  matchedRef.current = matched
  errorIdRef.current = errorId

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

  // Shortcuts: recalculated from visible tiles
  const shortcuts = useMemo(() => {
    const visible = tiles.filter((t) => !matched.has(t.id))
    return assignShortcuts(visible)
  }, [tiles, matched])

  // Keyboard handler — all logic inlined with refs to avoid stale closures
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey) return  // let browser handle Alt combos
      if (errorIdRef.current) return
      if (e.key.length !== 1) return
      const key = stripAccent(e.key.toLowerCase())
      const curTiles = tilesRef.current
      const curMatched = matchedRef.current
      const curSelected = selectedRef.current
      const visible = curTiles.filter((t) => !curMatched.has(t.id))
      const sc = assignShortcuts(visible)
      const tileId = [...sc.entries()].find(([, v]) => v === key)?.[0]
      if (!tileId) return
      const tile = curTiles.find((t) => t.id === tileId)
      if (!tile || curMatched.has(tile.id)) return

      if (curSelected?.id === tile.id) {
        setSelected(null)
        return
      }

      if (!curSelected) {
        setSelected(tile)
        return
      }

      // Check match
      if (curSelected.wordId === tile.wordId && curSelected.side !== tile.side) {
        const next = new Set(curMatched)
        next.add(curSelected.id)
        next.add(tile.id)
        setMatched(next)
        setSelected(null)
        if (next.size === curTiles.length) {
          const incorrect = Object.entries(errorCount.current)
            .filter(([, c]) => c > 0)
            .map(([id]) => Number(id))
          onComplete(incorrect)
        }
      } else {
        errorCount.current[curSelected.wordId] = (errorCount.current[curSelected.wordId] || 0) + 1
        errorCount.current[tile.wordId] = (errorCount.current[tile.wordId] || 0) + 1
        setErrorId(tile.id)
        setTimeout(() => { setErrorId(null); setSelected(null) }, 800)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {t('settings.exercises.pair_match')}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            onClick={() => handleTap(tile)}
            className={`px-4 py-2.5 rounded-xl border-2 font-medium text-sm transition-all duration-200 ${tileClass(tile)}`}
          >
            <ShortcutLabel text={tile.text} shortcut={shortcuts.get(tile.id) ?? ''} />
          </button>
        ))}
      </div>
    </div>
  )
}
