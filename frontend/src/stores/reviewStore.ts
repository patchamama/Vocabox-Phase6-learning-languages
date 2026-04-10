/**
 * reviewStore — motor de la sesión de repaso
 *
 * Tipos de ejercicio:
 *   multiple_choice | write | pair_match | first_letter | anagram
 *
 * Reglas:
 *   - Frase (≥3 palabras en palabra O significado) → solo multiple_choice / pair_match
 *   - Palabra corta → cualquiera de los 5
 *
 * Modo simple:  1 ejercicio por palabra → submitAnswer.
 * Modo seguro:  3 métodos DISTINTOS sin error → submitAnswer.
 *
 * Cola de errores: palabras falladas van a errorQueue (máx 1 entrada por palabra).
 * Al terminar la ronda principal se repasan. Si se pasan, salen.
 */

import { create } from 'zustand'
import { reviewApi } from '../api/client'
import type { ReviewWord } from '../types'

export type ExerciseType = 'multiple_choice' | 'write' | 'pair_match' | 'first_letter' | 'anagram'

// ── helpers ───────────────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length
}

function isPhrase(word: ReviewWord): boolean {
  return wordCount(word.palabra) >= 3 || wordCount(word.significado) >= 3
}

const PHRASE_TYPES: ExerciseType[] = ['multiple_choice', 'pair_match']
const ALL_TYPES: ExerciseType[] = ['multiple_choice', 'write', 'pair_match', 'first_letter', 'anagram']

function pickType(word: ReviewWord, exclude: ExerciseType[]): ExerciseType {
  const pool = (isPhrase(word) ? PHRASE_TYPES : ALL_TYPES).filter((t) => !exclude.includes(t))
  if (pool.length === 0) return isPhrase(word) ? 'multiple_choice' : 'write'
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── types ─────────────────────────────────────────────────────────────────────

export interface WordProgress {
  word: ReviewWord
  completedTypes: ExerciseType[]
  currentType: ExerciseType
  inErrorQueue: boolean
}

interface ReviewState {
  allWords: ReviewWord[]
  progress: Record<number, WordProgress>   // keyed by user_word_id
  queue: number[]                           // user_word_ids, main order
  queuePos: number
  errorQueue: number[]                      // user_word_ids that failed
  errorQueuePos: number
  inErrorPhase: boolean
  pairBatch: ReviewWord[]                   // current pair_match batch
  results: { correct: number; incorrect: number }
  isLoading: boolean
  isFinished: boolean
  mode: 'simple' | 'safe'

  loadReview: (boxes?: number[], limit?: number, mode?: 'simple' | 'safe') => Promise<void>
  handleSingleAnswer: (userWordId: number, correct: boolean) => void
  handlePairMatchComplete: (incorrectWordIds: number[]) => void
  patchWord: (user_word_id: number, patch: Partial<Pick<ReviewWord, 'palabra' | 'significado'>>) => void
  reset: () => void
  currentWord: () => ReviewWord | null
  currentExerciseType: () => ExerciseType | null
  progressPct: () => number
  errorQueueSize: () => number
  errorResolvedCount: () => number
}

const EMPTY_RESULTS = { correct: 0, incorrect: 0 }

const INITIAL = {
  allWords: [] as ReviewWord[],
  progress: {} as Record<number, WordProgress>,
  queue: [] as number[],
  queuePos: 0,
  errorQueue: [] as number[],
  errorQueuePos: 0,
  inErrorPhase: false,
  pairBatch: [] as ReviewWord[],
  results: EMPTY_RESULTS,
  isLoading: false,
  isFinished: false,
  mode: 'simple' as 'simple' | 'safe',
}

// ── advance helpers (pure, operate on current state via get()) ─────────────────

function neededCount(mode: 'simple' | 'safe') {
  return mode === 'safe' ? 3 : 1
}

function isDone(wp: WordProgress, mode: 'simple' | 'safe') {
  return wp.completedTypes.length >= neededCount(mode)
}

function advance(get: () => ReviewState, set: (s: Partial<ReviewState>) => void) {
  const state = get()
  const { queue, queuePos, errorQueue, inErrorPhase, progress, mode } = state

  if (!inErrorPhase) {
    // Find next main-queue word that still needs work and isn't in error queue
    let next = queuePos + 1
    while (next < queue.length) {
      const wp = progress[queue[next]]
      if (wp && !isDone(wp, mode) && !wp.inErrorQueue) break
      next++
    }

    if (next < queue.length) {
      const nextId = queue[next]
      const nextWp = progress[nextId]
      if (nextWp?.currentType === 'pair_match') {
        const batch = buildPairBatch(get(), next)
        set({ queuePos: batch.endIndex, pairBatch: batch.words })
      } else {
        set({ queuePos: next, pairBatch: [] })
      }
    } else if (errorQueue.length > 0) {
      set({ inErrorPhase: true, errorQueuePos: 0, pairBatch: [] })
      advanceError(get, set, -1)
    } else {
      set({ isFinished: true })
    }
  } else {
    advanceError(get, set, state.errorQueuePos)
  }
}

function advanceError(
  get: () => ReviewState,
  set: (s: Partial<ReviewState>) => void,
  currentPos: number
) {
  const { errorQueue, progress, mode } = get()
  let next = currentPos + 1

  while (next < errorQueue.length) {
    const wp = progress[errorQueue[next]]
    if (!wp || !isDone(wp, mode)) break
    // resolved — submit to backend
    reviewApi.submitAnswer(errorQueue[next], true).catch(() => {})
    next++
  }

  if (next < errorQueue.length) {
    set({ errorQueuePos: next })
  } else {
    set({ isFinished: true })
  }
}

function buildPairBatch(
  state: ReviewState,
  startIndex: number
): { words: ReviewWord[]; endIndex: number } {
  const { queue, progress, mode } = state
  const words: ReviewWord[] = []
  let i = startIndex
  while (i < queue.length && words.length < 4) {
    const wp = progress[queue[i]]
    if (wp && !isDone(wp, mode) && !wp.inErrorQueue && wp.currentType === 'pair_match') {
      words.push(wp.word)
    }
    i++
  }
  return { words, endIndex: i - 1 }
}

// ── store ─────────────────────────────────────────────────────────────────────

export const useReviewStore = create<ReviewState>((set, get) => ({
  ...INITIAL,

  loadReview: async (boxes, limit = 20, mode = 'simple') => {
    set({ ...INITIAL, isLoading: true, mode })
    try {
      const { data } = await reviewApi.getReview(limit, boxes)
      const words: ReviewWord[] = data

      const progress: Record<number, WordProgress> = {}
      for (const w of words) {
        progress[w.user_word_id] = {
          word: w,
          completedTypes: [],
          currentType: pickType(w, []),
          inErrorQueue: false,
        }
      }

      const queue = words.map((w) => w.user_word_id)

      // Check if first word is pair_match → set initial batch
      const firstWp = progress[queue[0]]
      let pairBatch: ReviewWord[] = []
      let queuePos = 0
      if (firstWp?.currentType === 'pair_match') {
        const batch = buildPairBatch({ ...INITIAL, progress, queue, mode } as ReviewState, 0)
        pairBatch = batch.words
        queuePos = batch.endIndex
      }

      set({
        allWords: words,
        progress,
        queue,
        queuePos,
        pairBatch,
        isLoading: false,
        isFinished: words.length === 0,
        mode,
      })
    } catch {
      set({ isLoading: false, isFinished: true })
    }
  },

  handleSingleAnswer: (userWordId, correct) => {
    const { progress, mode, errorQueue, results } = get()
    const wp = progress[userWordId]
    if (!wp) return

    const updatedResults = {
      correct: results.correct + (correct ? 1 : 0),
      incorrect: results.incorrect + (correct ? 0 : 1),
    }

    if (correct) {
      const completedTypes = [...wp.completedTypes, wp.currentType]
      const needsMore = mode === 'safe' && completedTypes.length < 3

      if (!needsMore) {
        reviewApi.submitAnswer(userWordId, true).catch(() => {})
      }

      const nextType = needsMore ? pickType(wp.word, completedTypes) : wp.currentType

      set({
        results: updatedResults,
        progress: {
          ...progress,
          [userWordId]: { ...wp, completedTypes, currentType: nextType },
        },
      })

      if (!needsMore) advance(get, set)
    } else {
      const newErrorQueue = wp.inErrorQueue ? errorQueue : [...errorQueue, userWordId]
      const newType = pickType(wp.word, [])

      set({
        results: updatedResults,
        errorQueue: newErrorQueue,
        progress: {
          ...progress,
          [userWordId]: { ...wp, completedTypes: [], currentType: newType, inErrorQueue: true },
        },
      })
      advance(get, set)
    }
  },

  handlePairMatchComplete: (incorrectWordIds) => {
    const { progress, errorQueue, results, mode } = get()
    const batch = get().pairBatch
    const newProgress = { ...progress }
    let newErrorQueue = [...errorQueue]
    let addCorrect = 0
    let addIncorrect = 0

    for (const w of batch) {
      const wp = newProgress[w.user_word_id]
      if (!wp) continue
      const hadError = incorrectWordIds.includes(w.user_word_id)

      if (hadError) {
        addIncorrect++
        if (!wp.inErrorQueue) newErrorQueue = [...newErrorQueue, w.user_word_id]
        newProgress[w.user_word_id] = {
          ...wp,
          completedTypes: [],
          currentType: pickType(w, []),
          inErrorQueue: true,
        }
      } else {
        addCorrect++
        const completedTypes = [...wp.completedTypes, 'pair_match' as ExerciseType]
        const needsMore = mode === 'safe' && completedTypes.length < 3
        if (!needsMore) reviewApi.submitAnswer(w.user_word_id, true).catch(() => {})
        newProgress[w.user_word_id] = {
          ...wp,
          completedTypes,
          currentType: needsMore ? pickType(w, completedTypes) : wp.currentType,
        }
      }
    }

    set({
      results: { correct: results.correct + addCorrect, incorrect: results.incorrect + addIncorrect },
      errorQueue: newErrorQueue,
      progress: newProgress,
      pairBatch: [],
    })
    advance(get, set)
  },

  patchWord: (user_word_id, patch) => {
    set((state) => {
      const wp = state.progress[user_word_id]
      if (!wp) return {}
      return {
        allWords: state.allWords.map((w) =>
          w.user_word_id === user_word_id ? { ...w, ...patch } : w
        ),
        progress: {
          ...state.progress,
          [user_word_id]: { ...wp, word: { ...wp.word, ...patch } },
        },
      }
    })
  },

  reset: () => set(INITIAL),

  currentWord: () => {
    const { inErrorPhase, queue, queuePos, errorQueue, errorQueuePos, progress, pairBatch } = get()
    if (pairBatch.length > 0) return null
    const id = inErrorPhase ? errorQueue[errorQueuePos] : queue[queuePos]
    return id !== undefined ? (progress[id]?.word ?? null) : null
  },

  currentExerciseType: () => {
    const { inErrorPhase, queue, queuePos, errorQueue, errorQueuePos, progress, pairBatch } = get()
    if (pairBatch.length > 0) return 'pair_match'
    const id = inErrorPhase ? errorQueue[errorQueuePos] : queue[queuePos]
    return id !== undefined ? (progress[id]?.currentType ?? null) : null
  },

  progressPct: () => {
    const { queue, progress, mode } = get()
    if (queue.length === 0) return 0
    const needed = neededCount(mode)
    const done = queue.filter((id) => (progress[id]?.completedTypes.length ?? 0) >= needed).length
    return (done / queue.length) * 100
  },

  errorQueueSize: () => get().errorQueue.length,

  errorResolvedCount: () => {
    const { errorQueue, progress, mode } = get()
    const needed = neededCount(mode)
    return errorQueue.filter((id) => (progress[id]?.completedTypes.length ?? 0) >= needed).length
  },
}))
