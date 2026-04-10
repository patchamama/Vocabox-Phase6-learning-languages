/**
 * reviewStore — motor de sesión de repaso
 *
 * MODO SIMPLE:
 *   Una sola ronda. Cada palabra se ejercita una vez con un tipo aleatorio.
 *   pair_match se inserta como batch cada PAIR_INTERVAL palabras.
 *
 * MODO SEGURO:
 *   3 rondas completas sobre todas las palabras.
 *   Cada ronda tiene un tipo configurado (safeRound1/2/3).
 *   Las frases siempre usan multiple_choice sin importar la config de ronda.
 *   pair_match en ronda → se agrupa en batches de 2-4 al construir la queue.
 *   Cola de errores: palabras que fallan se agregan a errorQueue (1 vez máx).
 *   Al final de cada ronda se repasan los errores antes de avanzar a la siguiente.
 */

import { create } from 'zustand'
import { reviewApi } from '../api/client'
import type { ReviewWord } from '../types'
import type { RoundType } from './settingsStore'

export type ExerciseType =
  | 'multiple_choice'
  | 'write'
  | 'pair_match'
  | 'first_letter'
  | 'anagram'

// ── helpers ───────────────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length
}

export function isPhrase(word: ReviewWord): boolean {
  return wordCount(word.palabra) >= 3 || wordCount(word.significado) >= 3
}

const ALL_SINGLE: ExerciseType[] = [
  'multiple_choice',
  'write',
  'first_letter',
  'anagram',
]

function randomSingle(exclude: ExerciseType[] = []): ExerciseType {
  const pool = ALL_SINGLE.filter((t) => !exclude.includes(t))
  if (pool.length === 0) return 'multiple_choice'
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Resolve a RoundType to a concrete ExerciseType for a given word. */
function resolveRoundType(
  roundType: RoundType,
  word: ReviewWord,
  usedInSession: ExerciseType[]
): ExerciseType {
  // Phrases always → multiple_choice
  if (isPhrase(word)) return 'multiple_choice'

  if (roundType === 'random') return randomSingle(usedInSession)

  // pair_match is valid for non-phrases
  if (roundType === 'pair_match') return 'pair_match'

  return roundType as ExerciseType
}

function log(...args: unknown[]) {
  console.log('[ReviewStore]', ...args)
}

// ── Queue building ────────────────────────────────────────────────────────────

type QueueItem =
  | { kind: 'single'; userWordId: number }
  | { kind: 'pair'; userWordIds: number[] }

const PAIR_INTERVAL = 5 // insert a pair batch after every N singles in simple mode

/**
 * Build a flat queue for a single round.
 * If roundType === 'pair_match': group all non-phrase words in batches of 2-4,
 *   with phrase words interleaved as single multiple_choice items.
 * Otherwise: single items, with pair batches inserted every PAIR_INTERVAL (simple mode only).
 */
function buildRoundQueue(
  words: ReviewWord[],
  roundType: RoundType,
  roundTypes: RoundType[] // for recording per-word exercise types
): { items: QueueItem[]; wordExerciseType: Record<number, ExerciseType> } {
  const wordExerciseType: Record<number, ExerciseType> = {}
  const items: QueueItem[] = []

  if (roundType === 'pair_match') {
    // Phrases go as single multiple_choice; non-phrases batched in pairs
    const phraseWords = words.filter((w) => isPhrase(w))
    const normalWords = words.filter((w) => !isPhrase(w))

    // Batch normal words
    for (let i = 0; i < normalWords.length; i += 4) {
      const batch = normalWords.slice(i, i + 4)
      if (batch.length === 1) {
        // Only 1 word — can't pair, downgrade to random single
        wordExerciseType[batch[0].user_word_id] = randomSingle()
        items.push({ kind: 'single', userWordId: batch[0].user_word_id })
      } else {
        batch.forEach((w) => { wordExerciseType[w.user_word_id] = 'pair_match' })
        items.push({ kind: 'pair', userWordIds: batch.map((w) => w.user_word_id) })
      }
    }
    // Phrase words as singles
    phraseWords.forEach((w) => {
      wordExerciseType[w.user_word_id] = 'multiple_choice'
      items.push({ kind: 'single', userWordId: w.user_word_id })
    })
  } else {
    // All words as singles with the resolved type
    words.forEach((w) => {
      const type = resolveRoundType(roundType, w, [])
      wordExerciseType[w.user_word_id] = type
      items.push({ kind: 'single', userWordId: w.user_word_id })
    })
  }

  return { items, wordExerciseType }
}

/**
 * Build the full item queue for a session.
 * Simple mode: 1 round, pair_match batches every PAIR_INTERVAL.
 * Safe mode: 3 rounds, each with its configured type.
 */
function buildSessionQueue(
  words: ReviewWord[],
  mode: 'simple' | 'safe',
  rounds: [RoundType, RoundType, RoundType]
): {
  items: QueueItem[]
  /** For each round (0-2), the exercise type assigned to each word */
  roundWordTypes: Array<Record<number, ExerciseType>>
} {
  if (mode === 'simple') {
    // Single round: mix of singles + pair batches every PAIR_INTERVAL
    const items: QueueItem[] = []
    const wordTypes: Record<number, ExerciseType> = {}
    let sinceLastPair = 0

    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      const type = resolveRoundType('random', w, [])
      wordTypes[w.user_word_id] = type
      items.push({ kind: 'single', userWordId: w.user_word_id })
      sinceLastPair++

      if (sinceLastPair >= PAIR_INTERVAL && i + 1 < words.length) {
        const batchWords = words.slice(i + 1, i + 5).filter((bw) => !isPhrase(bw))
        if (batchWords.length >= 2) {
          batchWords.forEach((bw) => { wordTypes[bw.user_word_id] = 'pair_match' })
          items.push({ kind: 'pair', userWordIds: batchWords.map((bw) => bw.user_word_id) })
          sinceLastPair = 0
        }
      }
    }
    return { items, roundWordTypes: [wordTypes, {}, {}] }
  }

  // Safe mode: 3 rounds
  const roundWordTypes: Array<Record<number, ExerciseType>> = []
  const allItems: QueueItem[] = []

  for (let r = 0; r < 3; r++) {
    const { items, wordExerciseType } = buildRoundQueue(words, rounds[r], [])
    // Shuffle within each round so it's not always the same order
    const shuffled = [...items].sort(() => Math.random() - 0.5)
    allItems.push(...shuffled)
    roundWordTypes.push(wordExerciseType)
  }

  return { items: allItems, roundWordTypes }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WordRoundState {
  /** Which round (0-based) the word is currently on */
  currentRound: number
  /** Whether the word has passed the current round's exercise */
  roundDone: boolean[]  // length 3 (or 1 for simple)
  inErrorQueue: boolean
}

interface ReviewState {
  allWords: ReviewWord[]
  /** Exercise type per word per round: roundWordTypes[round][userWordId] */
  roundWordTypes: Array<Record<number, ExerciseType>>
  wordState: Record<number, WordRoundState>
  items: QueueItem[]
  itemPos: number
  /** Current round (0-indexed). In simple mode always 0. */
  currentRound: number
  totalRounds: number
  /** Error queue: user_word_ids that failed in current round */
  errorQueue: number[]
  errorQueuePos: number
  inErrorPhase: boolean
  results: { correct: number; incorrect: number }
  isLoading: boolean
  isFinished: boolean
  mode: 'simple' | 'safe'

  loadReview: (
    boxes?: number[],
    limit?: number,
    mode?: 'simple' | 'safe',
    rounds?: [RoundType, RoundType, RoundType],
    wordsOnly?: boolean
  ) => Promise<void>
  handleSingleAnswer: (userWordId: number, correct: boolean) => void
  handlePairMatchComplete: (incorrectWordIds: number[]) => void
  patchWord: (
    user_word_id: number,
    patch: Partial<Pick<ReviewWord, 'palabra' | 'significado'>>
  ) => void
  reset: () => void

  currentItem: () => QueueItem | null
  currentWord: () => ReviewWord | null
  currentExerciseType: () => ExerciseType | null
  currentPairWords: () => ReviewWord[]
  progressPct: () => number
  errorQueueSize: () => number
  errorResolvedCount: () => number
}

const INITIAL_DATA = {
  allWords: [] as ReviewWord[],
  roundWordTypes: [{}, {}, {}] as Array<Record<number, ExerciseType>>,
  wordState: {} as Record<number, WordRoundState>,
  items: [] as QueueItem[],
  itemPos: 0,
  currentRound: 0,
  totalRounds: 1,
  errorQueue: [] as number[],
  errorQueuePos: 0,
  inErrorPhase: false,
  results: { correct: 0, incorrect: 0 },
  isLoading: false,
  isFinished: false,
  mode: 'simple' as 'simple' | 'safe',
}

// ── Advance logic ─────────────────────────────────────────────────────────────

function isItemDoneInRound(
  item: QueueItem,
  round: number,
  wordState: Record<number, WordRoundState>
): boolean {
  if (item.kind === 'single') {
    const ws = wordState[item.userWordId]
    return !ws || ws.roundDone[round] || ws.inErrorQueue
  }
  // pair: done if ALL active words in batch are done or in error queue
  return item.userWordIds.every((id) => {
    const ws = wordState[id]
    return !ws || ws.roundDone[round] || ws.inErrorQueue
  })
}

function getActivePairWords(
  item: { kind: 'pair'; userWordIds: number[] },
  round: number,
  wordState: Record<number, WordRoundState>,
  allWords: ReviewWord[]
): ReviewWord[] {
  const wordMap: Record<number, ReviewWord> = {}
  allWords.forEach((w) => { wordMap[w.user_word_id] = w })
  return item.userWordIds
    .filter((id) => {
      const ws = wordState[id]
      return ws && !ws.roundDone[round] && !ws.inErrorQueue
    })
    .map((id) => wordMap[id])
    .filter(Boolean)
}

function advance(get: () => ReviewState, set: (s: Partial<ReviewState>) => void) {
  const { items, itemPos, errorQueue, inErrorPhase, wordState, currentRound, totalRounds, mode } = get()

  log('advance: itemPos=', itemPos, 'inErrorPhase=', inErrorPhase, 'round=', currentRound)

  if (inErrorPhase) {
    advanceError(get, set)
    return
  }

  // Find next item in current round that isn't done
  let next = itemPos + 1
  while (next < items.length) {
    const item = items[next]

    // Only process items belonging to current round
    const itemRound = getItemRound(next, items, totalRounds, get().allWords.length)
    if (itemRound !== currentRound) {
      // We've passed the current round's items — enter error phase or next round
      break
    }

    if (!isItemDoneInRound(item, currentRound, wordState)) break
    next++
  }

  const nextItem = items[next]
  const nextRound = nextItem ? getItemRound(next, items, totalRounds, get().allWords.length) : -1

  if (nextItem && nextRound === currentRound) {
    log('advance → itemPos=', next)
    set({ itemPos: next })
    return
  }

  // Current round exhausted — check error queue
  if (errorQueue.length > 0) {
    log('advance → entering error phase for round', currentRound)
    set({ inErrorPhase: true, errorQueuePos: 0 })
    advanceError(get, set)
    return
  }

  // No errors — try next round
  const nextRoundNum = currentRound + 1
  if (mode === 'safe' && nextRoundNum < totalRounds) {
    log('advance → starting round', nextRoundNum)
    // Find first item of next round
    const firstOfNextRound = findFirstItemOfRound(nextRoundNum, items, totalRounds, get().allWords.length)
    set({ currentRound: nextRoundNum, itemPos: firstOfNextRound, errorQueue: [], inErrorPhase: false })
    return
  }

  log('advance → finished')
  set({ isFinished: true })
}

function advanceError(get: () => ReviewState, set: (s: Partial<ReviewState>) => void) {
  const { errorQueue, errorQueuePos, wordState, currentRound } = get()
  let next = errorQueuePos + 1

  while (next < errorQueue.length) {
    const ws = wordState[errorQueue[next]]
    if (!ws || !ws.roundDone[currentRound]) break
    // resolved
    reviewApi.submitAnswer(errorQueue[next], true).catch(() => {})
    next++
  }

  if (next < errorQueue.length) {
    log('advanceError → errorQueuePos=', next)
    set({ errorQueuePos: next })
    return
  }

  // Error phase done — move to next round if safe mode
  const { currentRound: round, totalRounds, mode, items, allWords } = get()
  const nextRound = round + 1

  if (mode === 'safe' && nextRound < totalRounds) {
    log('advanceError → next round', nextRound)
    const firstOfNextRound = findFirstItemOfRound(nextRound, items, totalRounds, allWords.length)
    set({ currentRound: nextRound, itemPos: firstOfNextRound, errorQueue: [], inErrorPhase: false, errorQueuePos: 0 })
    return
  }

  log('advanceError → finished')
  set({ isFinished: true })
}

/**
 * Items are split into `totalRounds` equal segments.
 * Round r covers indices [r * segLen, (r+1) * segLen).
 */
function getItemRound(itemIndex: number, items: QueueItem[], totalRounds: number, _wordCount: number): number {
  if (totalRounds <= 1) return 0
  const segLen = Math.ceil(items.length / totalRounds)
  return Math.min(Math.floor(itemIndex / segLen), totalRounds - 1)
}

function findFirstItemOfRound(round: number, items: QueueItem[], totalRounds: number, wordCount: number): number {
  for (let i = 0; i < items.length; i++) {
    if (getItemRound(i, items, totalRounds, wordCount) === round) return i
  }
  return items.length
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useReviewStore = create<ReviewState>((set, get) => ({
  ...INITIAL_DATA,

  loadReview: async (boxes, limit = 20, mode = 'simple', rounds = ['pair_match', 'first_letter', 'random'], wordsOnly = false) => {
    log('loadReview: limit=', limit, 'mode=', mode, 'wordsOnly=', wordsOnly)
    set({ ...INITIAL_DATA, isLoading: true, mode })

    try {
      const { data } = await reviewApi.getReview(limit, boxes, wordsOnly)
      const words: ReviewWord[] = data
      log('loadReview: received', words.length, 'words')

      const totalRounds = mode === 'safe' ? 3 : 1
      const { items, roundWordTypes } = buildSessionQueue(words, mode, rounds)
      log('loadReview: built', items.length, 'items across', totalRounds, 'rounds')
      log('items:', items)

      const wordState: Record<number, WordRoundState> = {}
      words.forEach((w) => {
        wordState[w.user_word_id] = {
          currentRound: 0,
          roundDone: [false, false, false],
          inErrorQueue: false,
        }
      })

      set({
        allWords: words,
        roundWordTypes,
        wordState,
        items,
        itemPos: 0,
        currentRound: 0,
        totalRounds,
        isLoading: false,
        isFinished: words.length === 0,
        mode,
      })
    } catch (e) {
      log('loadReview error:', e)
      set({ isLoading: false, isFinished: true })
    }
  },

  handleSingleAnswer: (userWordId, correct) => {
    const { wordState, currentRound, errorQueue, results, mode } = get()
    const ws = wordState[userWordId]
    if (!ws) return

    log('handleSingleAnswer: id=', userWordId, 'correct=', correct, 'round=', currentRound)

    const updatedResults = {
      correct: results.correct + (correct ? 1 : 0),
      incorrect: results.incorrect + (correct ? 0 : 1),
    }

    if (correct) {
      const newRoundDone = [...ws.roundDone] as [boolean, boolean, boolean]
      newRoundDone[currentRound] = true

      const allRoundsDone = mode === 'simple'
        ? newRoundDone[0]
        : newRoundDone[0] && newRoundDone[1] && newRoundDone[2]

      if (allRoundsDone) {
        log('  word fully done, submitting to backend')
        reviewApi.submitAnswer(userWordId, true).catch(() => {})
      }

      set({
        results: updatedResults,
        wordState: {
          ...wordState,
          [userWordId]: { ...ws, roundDone: newRoundDone },
        },
      })
      advance(get, set)
    } else {
      const newErrorQueue = ws.inErrorQueue ? errorQueue : [...errorQueue, userWordId]
      log('  incorrect: adding to errorQueue')
      set({
        results: updatedResults,
        errorQueue: newErrorQueue,
        wordState: {
          ...wordState,
          [userWordId]: { ...ws, inErrorQueue: true },
        },
      })
      advance(get, set)
    }
  },

  handlePairMatchComplete: (incorrectWordIds) => {
    const state = get()
    const item = state.items[state.itemPos]
    if (!item || item.kind !== 'pair') {
      log('handlePairMatchComplete: current item is not a pair!', item)
      return
    }

    const { wordState, errorQueue, results, currentRound, mode } = state
    const activeIds = item.userWordIds.filter((id) => {
      const ws = wordState[id]
      return ws && !ws.roundDone[currentRound] && !ws.inErrorQueue
    })

    log('handlePairMatchComplete: activeIds=', activeIds, 'incorrect=', incorrectWordIds)

    const newWordState = { ...wordState }
    let newErrorQueue = [...errorQueue]
    let addCorrect = 0
    let addIncorrect = 0

    for (const id of activeIds) {
      const ws = newWordState[id]
      if (!ws) continue
      const hadError = incorrectWordIds.includes(id)

      if (hadError) {
        addIncorrect++
        if (!ws.inErrorQueue) newErrorQueue = [...newErrorQueue, id]
        newWordState[id] = { ...ws, inErrorQueue: true }
      } else {
        addCorrect++
        const newRoundDone = [...ws.roundDone] as [boolean, boolean, boolean]
        newRoundDone[currentRound] = true
        const allDone = mode === 'simple'
          ? newRoundDone[0]
          : newRoundDone[0] && newRoundDone[1] && newRoundDone[2]
        if (allDone) reviewApi.submitAnswer(id, true).catch(() => {})
        newWordState[id] = { ...ws, roundDone: newRoundDone }
      }
    }

    set({
      results: { correct: results.correct + addCorrect, incorrect: results.incorrect + addIncorrect },
      errorQueue: newErrorQueue,
      wordState: newWordState,
    })
    advance(get, set)
  },

  patchWord: (user_word_id, patch) => {
    set((state) => {
      const wordIndex = state.allWords.findIndex((w) => w.user_word_id === user_word_id)
      if (wordIndex === -1) return {}
      const newWords = [...state.allWords]
      newWords[wordIndex] = { ...newWords[wordIndex], ...patch }
      return { allWords: newWords }
    })
  },

  reset: () => {
    log('reset')
    set(INITIAL_DATA)
  },

  currentItem: () => {
    const { inErrorPhase, items, itemPos, errorQueue, errorQueuePos } = get()
    if (inErrorPhase) {
      const id = errorQueue[errorQueuePos]
      return id !== undefined ? { kind: 'single' as const, userWordId: id } : null
    }
    return items[itemPos] ?? null
  },

  currentWord: () => {
    const item = get().currentItem()
    if (!item || item.kind !== 'single') return null
    return get().allWords.find((w) => w.user_word_id === item.userWordId) ?? null
  },

  currentExerciseType: () => {
    const { inErrorPhase, currentRound, roundWordTypes, wordState, errorQueue, errorQueuePos } = get()
    const item = get().currentItem()
    if (!item) return null
    if (item.kind === 'pair') return 'pair_match'

    if (inErrorPhase) {
      const id = errorQueue[errorQueuePos]
      const ws = wordState[id]
      const word = get().allWords.find((w) => w.user_word_id === id)
      if (!word) return 'multiple_choice'
      if (isPhrase(word)) return 'multiple_choice'
      // Use a different type than what failed (pick from remaining rounds or random)
      return randomSingle([])
    }

    return roundWordTypes[currentRound]?.[item.userWordId] ?? 'multiple_choice'
  },

  currentPairWords: () => {
    const { items, itemPos, currentRound, wordState, allWords } = get()
    const item = items[itemPos]
    if (!item || item.kind !== 'pair') return []
    return getActivePairWords(item, currentRound, wordState, allWords)
  },

  progressPct: () => {
    const { allWords, wordState, mode, currentRound, totalRounds } = get()
    if (allWords.length === 0) return 0

    if (mode === 'simple') {
      const done = allWords.filter((w) => wordState[w.user_word_id]?.roundDone[0]).length
      return (done / allWords.length) * 100
    }

    // Safe mode: progress within current round
    const done = allWords.filter((w) => wordState[w.user_word_id]?.roundDone[currentRound]).length
    const roundBase = currentRound / totalRounds
    const roundProgress = done / allWords.length / totalRounds
    return (roundBase + roundProgress) * 100
  },

  errorQueueSize: () => get().errorQueue.length,

  errorResolvedCount: () => {
    const { errorQueue, wordState, currentRound } = get()
    return errorQueue.filter((id) => wordState[id]?.roundDone[currentRound]).length
  },
}))
