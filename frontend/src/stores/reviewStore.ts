import { create } from 'zustand'
import { reviewApi } from '../api/client'
import type { ReviewWord } from '../types'

interface ReviewState {
  words: ReviewWord[]
  currentIndex: number
  results: { correct: number; incorrect: number }
  isLoading: boolean
  isFinished: boolean
  loadReview: () => Promise<void>
  submitAnswer: (user_word_id: number, correct: boolean) => Promise<void>
  nextWord: () => void
  reset: () => void
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  words: [],
  currentIndex: 0,
  results: { correct: 0, incorrect: 0 },
  isLoading: false,
  isFinished: false,

  loadReview: async () => {
    set({ isLoading: true, isFinished: false, currentIndex: 0, results: { correct: 0, incorrect: 0 } })
    try {
      const { data } = await reviewApi.getReview()
      set({ words: data, isLoading: false, isFinished: data.length === 0 })
    } catch {
      set({ isLoading: false, isFinished: true })
    }
  },

  submitAnswer: async (user_word_id, correct) => {
    await reviewApi.submitAnswer(user_word_id, correct)
    const { results } = get()
    set({
      results: {
        correct: results.correct + (correct ? 1 : 0),
        incorrect: results.incorrect + (correct ? 0 : 1),
      },
    })
  },

  nextWord: () => {
    const { currentIndex, words } = get()
    if (currentIndex + 1 >= words.length) {
      set({ isFinished: true })
    } else {
      set({ currentIndex: currentIndex + 1 })
    }
  },

  reset: () =>
    set({ words: [], currentIndex: 0, results: { correct: 0, incorrect: 0 }, isFinished: false }),
}))
