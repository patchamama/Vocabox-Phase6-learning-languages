/**
 * AnagramExercise
 *
 * – Available letters: one button per UNIQUE letter; a count badge shows
 *   how many of that letter remain. When all copies are used the button
 *   disappears entirely (no ghost space).
 * – If a letter appears more than once, selecting it once keeps the button
 *   visible (count decreases) until the last copy is used.
 * – Backspace key / "Borrar última" undoes the last filled slot and returns
 *   the letter to the pool.
 * – All printable keyboard characters are forwarded to pickTile.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReviewWord } from '../../types'
import { langPair } from '../../utils/langFlags'

interface LetterTile {
  id: string   // unique per physical letter: `${index}-${char}`
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

/** Groups tiles by char, preserving shuffle order for display */
function groupTiles(tiles: LetterTile[]): { char: string; available: LetterTile[] }[] {
  const seen = new Map<string, LetterTile[]>()
  for (const t of tiles) {
    const key = t.char.toLowerCase()
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key)!.push(t)
  }
  // Maintain the shuffle order: first occurrence of each char determines position
  const order: string[] = []
  for (const t of tiles) {
    const key = t.char.toLowerCase()
    if (!order.includes(key)) order.push(key)
  }
  return order.map((key) => ({
    char: seen.get(key)![0].char,           // display char (original case)
    available: seen.get(key)!.filter((t) => !t.used),
  })).filter((g) => g.available.length > 0) // hide when exhausted
}

export default function AnagramExercise({ word, onAnswer }: Props) {
  const { t } = useTranslation()
  const target = word.significado

  const initialTiles: LetterTile[] = useMemo(() => {
    const chars = target.replace(/\s/g, '').split('')
    return shuffleArray(chars.map((c, i) => ({ id: `${i}-${c}`, char: c, used: false })))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id])

  const [tiles, setTiles] = useState<LetterTile[]>(initialTiles)
  const [filled, setFilled] = useState<(string | null)[]>([])
  const [filledIds, setFilledIds] = useState<(string | null)[]>([])
  const [flash, setFlash] = useState<'correct' | 'error' | null>(null)

  const layout = useMemo(() => target.split(''), [target])
  const slotCount = useMemo(() => target.replace(/\s/g, '').length, [target])

  // Refs for keyboard handler (stale-closure-safe)
  const tilesRef = useRef(tiles)
  const filledRef = useRef(filled)
  const filledIdsRef = useRef(filledIds)
  const flashRef = useRef(flash)
  useEffect(() => { tilesRef.current = tiles }, [tiles])
  useEffect(() => { filledRef.current = filled }, [filled])
  useEffect(() => { filledIdsRef.current = filledIds }, [filledIds])
  useEffect(() => { flashRef.current = flash }, [flash])

  useEffect(() => {
    setTiles(initialTiles)
    setFilled(Array(slotCount).fill(null))
    setFilledIds(Array(slotCount).fill(null))
    setFlash(null)
  }, [word.user_word_id, initialTiles, slotCount])

  const nextSlotIndex = filled.findIndex((f) => f === null)

  /** Consume the first available tile of the given char */
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

  const removeLast = () => {
    if (flash) return
    const lastFilled = [...filled].reverse().findIndex((f) => f !== null)
    if (lastFilled === -1) return
    const idx = filled.length - 1 - lastFilled
    const tileId = filledIds[idx]

    const newFilled = [...filled]; newFilled[idx] = null
    const newFilledIds = [...filledIds]; newFilledIds[idx] = null
    setTiles((prev) => prev.map((t) => t.id === tileId ? { ...t, used: false } : t))
    setFilled(newFilled)
    setFilledIds(newFilledIds)
  }

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (flashRef.current) return
      if (e.key === 'Backspace') {
        e.preventDefault()
        // inline removeLast using refs (avoids stale closure)
        const curFilled = filledRef.current
        const curFilledIds = filledIdsRef.current
        const lastFilled = [...curFilled].reverse().findIndex((f) => f !== null)
        if (lastFilled === -1) return
        const idx = curFilled.length - 1 - lastFilled
        const tileId = curFilledIds[idx]
        const newFilled = [...curFilled]; newFilled[idx] = null
        const newFilledIds = [...curFilledIds]; newFilledIds[idx] = null
        setFilled(newFilled)
        setFilledIds(newFilledIds)
        setTiles((prev) => prev.map((t) => t.id === tileId ? { ...t, used: false } : t))
        return
      }
      // Any printable single char → try to match an available tile
      if (e.key.length !== 1) return
      const ch = e.key.toLowerCase()
      const tile = tilesRef.current.find((t) => !t.used && t.char.toLowerCase() === ch)
      if (tile) pickTile(tile)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id])

  // ── Render ────────────────────────────────────────────────────────────────

  // Answer slots (spaces shown as visual gap)
  let slotIdx = 0
  const answerDisplay = layout.map((char, i) => {
    if (char === ' ') return <span key={`sp-${i}`} className="w-3" />
    const currentSlot = slotIdx
    const value = filled[currentSlot]
    slotIdx++
    const isNext = currentSlot === nextSlotIndex

    let boxClass = 'border-slate-500 dark:border-slate-500 text-slate-400'
    if (flash === 'correct') boxClass = 'border-green-500 text-green-400 bg-green-500/10'
    else if (flash === 'error') boxClass = 'border-red-500 text-red-400 bg-red-500/10'
    else if (value) boxClass = 'border-blue-400 text-slate-900 dark:text-white bg-blue-500/10'
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

  // Unique letter buttons — one per distinct char, hidden when count = 0
  const groups = groupTiles(tiles)

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Source word */}
      <div className="card text-center">
        <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
          {langPair(word.idioma_origen, word.idioma_destino)}
        </p>
        <p className="text-4xl font-bold">{word.palabra}</p>
      </div>

      {/* Answer slots */}
      <div className="card">
        <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center mb-3">
          {t('settings.exercises.anagramHint')}
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

      {/* Available letter tiles — unique chars only, count badge when > 1 */}
      <div className="flex flex-wrap gap-2 justify-center">
        {groups.map((g) => (
          <button
            key={g.char.toLowerCase()}
            onClick={() => pickTile(g.available[0])}
            disabled={!!flash}
            className="relative w-11 h-11 rounded-xl border-2 border-slate-500 dark:border-slate-500 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white text-lg font-bold uppercase transition-all duration-150 active:scale-90 hover:border-blue-400 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
          >
            {g.char.toUpperCase()}
            {g.available.length > 1 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                {g.available.length}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
