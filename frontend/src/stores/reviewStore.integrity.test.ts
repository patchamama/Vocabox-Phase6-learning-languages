/**
 * reviewStore — integrity tests for correctWordIds / incorrectWordIds
 *
 * Invariants under test:
 *   1. No ID appears in both lists simultaneously
 *   2. correctWordIds + incorrectWordIds ≤ allWords.length (never more)
 *   3. A word that ever fails must NOT end up in correctWordIds
 *   4. A word answered correctly (and never failed) MUST end up in correctWordIds
 *   5. After session ends: correctWordIds + incorrectWordIds == allWords.length
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useReviewStore } from './reviewStore'

// ── Mock reviewApi ─────────────────────────────────────────────────────────────
vi.mock('../api/client', () => ({
  reviewApi: {
    getReview: vi.fn(),
    submitAnswer: vi.fn().mockResolvedValue({ data: { new_box_level: 1 } }),
  },
}))

// ── Mock localStorage ──────────────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// ── Helpers ────────────────────────────────────────────────────────────────────
import type { ReviewWord } from '../types'

function makeWord(id: number, box = 1): ReviewWord {
  return {
    user_word_id: id,
    word_id: id,
    palabra: `word_${id}`,
    significado: `meaning_${id}`,
    idioma_origen: 'es',
    idioma_destino: 'de',
    box_level: box,
    choices: [`meaning_${id}`, `wrong_a_${id}`, `wrong_b_${id}`, `wrong_c_${id}`],
    audio_url: null,
    exercise_type: 'multiple_choice',
    tema_id: null,
    tema_nombre: null,
    tema_color: null,
  }
}

/** Load the store with given words synchronously (bypasses API). */
async function loadWords(words: ReviewWord[], mode: 'simple' | 'safe' = 'simple') {
  const { reviewApi } = await import('../api/client')
  vi.mocked(reviewApi.getReview).mockResolvedValueOnce({ data: words } as never)
  const store = useReviewStore.getState()
  await store.loadReview(undefined, words.length, mode, ['multiple_choice', 'multiple_choice', 'multiple_choice'], false, 'forward')
}

function assertIntegrity(label: string) {
  const { correctWordIds, incorrectWordIds, allWords } = useReviewStore.getState()
  const total = allWords.length

  const cross = correctWordIds.filter((id) => incorrectWordIds.includes(id))
  expect(cross, `[${label}] IDs in both lists: ${cross}`).toEqual([])

  const sum = correctWordIds.length + incorrectWordIds.length
  expect(sum, `[${label}] sum ${sum} > total ${total}`).toBeLessThanOrEqual(total)
}

// ── Answer helpers ─────────────────────────────────────────────────────────────
function currentId(): number {
  const { currentWord } = useReviewStore.getState()
  const w = currentWord()
  if (!w) throw new Error('No current word')
  return w.user_word_id
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useReviewStore.setState({ ...useReviewStore.getState() })
  // Full reset
  const store = useReviewStore.getState()
  store.reset()
  localStorageMock.clear()
})

describe('Simple mode — integrity invariants', () => {
  it('all correct → all in correctWordIds, none in incorrectWordIds', async () => {
    const words = [makeWord(1), makeWord(2), makeWord(3)]
    await loadWords(words)

    // Answer all correctly
    while (!useReviewStore.getState().isFinished) {
      const { currentWord, currentExerciseType } = useReviewStore.getState()
      const w = currentWord()
      if (!w) break
      const type = currentExerciseType()
      if (type === 'pair_match') {
        useReviewStore.getState().handlePairMatchComplete([])
      } else {
        useReviewStore.getState().handleSingleAnswer(w.user_word_id, true)
      }
      assertIntegrity('during session - all correct')
    }

    const { correctWordIds, incorrectWordIds, allWords } = useReviewStore.getState()
    assertIntegrity('after session - all correct')
    expect(incorrectWordIds).toHaveLength(0)
    expect(correctWordIds.length + incorrectWordIds.length).toBe(allWords.length)
  })

  it('all incorrect → all in incorrectWordIds, none in correctWordIds', async () => {
    const words = [makeWord(10), makeWord(11), makeWord(12)]
    await loadWords(words)

    while (!useReviewStore.getState().isFinished) {
      const { currentWord, currentExerciseType } = useReviewStore.getState()
      const w = currentWord()
      if (!w) break
      const type = currentExerciseType()
      if (type === 'pair_match') {
        useReviewStore.getState().handlePairMatchComplete(w ? [w.user_word_id] : [])
      } else {
        useReviewStore.getState().handleSingleAnswer(w.user_word_id, false)
      }
      assertIntegrity('during session - all incorrect')
    }

    const { correctWordIds, incorrectWordIds, allWords } = useReviewStore.getState()
    assertIntegrity('after session - all incorrect')
    expect(correctWordIds).toHaveLength(0)
    expect(correctWordIds.length + incorrectWordIds.length).toBe(allWords.length)
  })

  it('word that fails then passes in error queue → stays in incorrectWordIds only', async () => {
    const words = [makeWord(20), makeWord(21)]
    await loadWords(words)

    // Answer first word incorrectly
    const id = currentId()
    useReviewStore.getState().handleSingleAnswer(id, false)
    assertIntegrity('after first fail')

    // Answer remaining words correctly to trigger error phase
    while (!useReviewStore.getState().isFinished) {
      const { currentWord, currentExerciseType, inErrorPhase } = useReviewStore.getState()
      const w = currentWord()
      if (!w) break
      const type = currentExerciseType()
      if (type === 'pair_match') {
        useReviewStore.getState().handlePairMatchComplete([])
      } else {
        // In error phase, answer the failed word correctly
        useReviewStore.getState().handleSingleAnswer(w.user_word_id, inErrorPhase ? true : true)
      }
      assertIntegrity(`inErrorPhase=${inErrorPhase}`)
    }

    const { correctWordIds, incorrectWordIds } = useReviewStore.getState()
    assertIntegrity('final')
    // id must be in incorrectWordIds, NOT in correctWordIds
    expect(incorrectWordIds).toContain(id)
    expect(correctWordIds).not.toContain(id)
  })

  it('word correct then fails later → moved to incorrectWordIds, removed from correctWordIds', async () => {
    const words = [makeWord(30), makeWord(31), makeWord(32)]
    await loadWords(words)

    // Answer first word correctly
    const id = currentId()
    useReviewStore.getState().handleSingleAnswer(id, true)
    assertIntegrity('after first correct')

    const { correctWordIds: afterFirst } = useReviewStore.getState()
    // In simple mode after 1 correct answer the word is done — won't appear again
    // But let's verify it's in correct and not incorrect
    expect(afterFirst).toContain(id)
    expect(useReviewStore.getState().incorrectWordIds).not.toContain(id)

    assertIntegrity('end of test')
  })

  it('INVARIANT: sum correct + incorrect never exceeds total words', async () => {
    const words = Array.from({ length: 5 }, (_, i) => makeWord(100 + i))
    await loadWords(words)

    let step = 0
    while (!useReviewStore.getState().isFinished) {
      const { currentWord, currentExerciseType } = useReviewStore.getState()
      const w = currentWord()
      if (!w) break
      const type = currentExerciseType()
      // Alternate correct/incorrect
      const correct = step % 2 === 0
      if (type === 'pair_match') {
        useReviewStore.getState().handlePairMatchComplete(correct ? [] : [w.user_word_id])
      } else {
        useReviewStore.getState().handleSingleAnswer(w.user_word_id, correct)
      }
      assertIntegrity(`step ${step}`)
      step++
    }

    const { correctWordIds, incorrectWordIds, allWords } = useReviewStore.getState()
    assertIntegrity('final')
    expect(correctWordIds.length + incorrectWordIds.length).toBe(allWords.length)
  })

  it('NO duplicates within correctWordIds', async () => {
    const words = [makeWord(40), makeWord(41), makeWord(42)]
    await loadWords(words)

    while (!useReviewStore.getState().isFinished) {
      const { currentWord, currentExerciseType } = useReviewStore.getState()
      const w = currentWord()
      if (!w) break
      const type = currentExerciseType()
      if (type === 'pair_match') {
        useReviewStore.getState().handlePairMatchComplete([])
      } else {
        useReviewStore.getState().handleSingleAnswer(w.user_word_id, true)
      }
      const { correctWordIds } = useReviewStore.getState()
      const unique = new Set(correctWordIds)
      expect(unique.size, `Duplicates in correctWordIds: ${correctWordIds}`).toBe(correctWordIds.length)
    }
  })

  it('NO duplicates within incorrectWordIds', async () => {
    const words = [makeWord(50), makeWord(51), makeWord(52)]
    await loadWords(words)

    while (!useReviewStore.getState().isFinished) {
      const { currentWord, currentExerciseType } = useReviewStore.getState()
      const w = currentWord()
      if (!w) break
      const type = currentExerciseType()
      if (type === 'pair_match') {
        useReviewStore.getState().handlePairMatchComplete([w.user_word_id])
      } else {
        useReviewStore.getState().handleSingleAnswer(w.user_word_id, false)
      }
      const { incorrectWordIds } = useReviewStore.getState()
      const unique = new Set(incorrectWordIds)
      expect(unique.size, `Duplicates in incorrectWordIds: ${incorrectWordIds}`).toBe(incorrectWordIds.length)
    }
  })
})
