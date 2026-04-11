import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ReviewMode = 'simple' | 'safe'
export type TransitionType = 'auto' | 'button'
export type RoundType = 'pair_match' | 'first_letter' | 'anagram' | 'write' | 'multiple_choice' | 'random'

// Default Leitner spacing: box 0 = same day, box 1 = 1d, box 2 = 2d, box 3 = 4d, box 4 = 7d, box 5 = 14d, box 6 = 30d
export const DEFAULT_LEITNER_DAYS: [number, number, number, number, number, number, number] = [0, 1, 2, 4, 7, 14, 30]

interface SettingsState {
  reviewMode: ReviewMode
  wordsPerSession: number
  transitionDelay: number
  transitionType: TransitionType

  /** Exercise type to use in each of the 3 safe-mode rounds (for non-phrase words) */
  safeRound1: RoundType
  safeRound2: RoundType
  safeRound3: RoundType
  /** Auto-play word pronunciation when an exercise loads */
  autoPlayAudio: boolean
  /** Filter out phrases (>2 words) across the whole app */
  wordsOnly: boolean
  /** Days to wait per box level before word is due again (Leitner spacing) */
  leitnerDays: [number, number, number, number, number, number, number]

  setReviewMode: (mode: ReviewMode) => void
  setWordsPerSession: (n: number) => void
  setTransitionDelay: (s: number) => void
  setTransitionType: (t: TransitionType) => void
  setSafeRound: (round: 1 | 2 | 3, type: RoundType) => void
  setAutoPlayAudio: (v: boolean) => void
  setWordsOnly: (v: boolean) => void
  setLeitnerDay: (box: number, days: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      reviewMode: 'simple',
      wordsPerSession: 20,
      transitionDelay: 3,
      transitionType: 'auto',
      safeRound1: 'pair_match',
      safeRound2: 'first_letter',
      safeRound3: 'random',
      autoPlayAudio: false,
      wordsOnly: false,
      leitnerDays: DEFAULT_LEITNER_DAYS,

      setReviewMode: (reviewMode) => set({ reviewMode }),
      setWordsPerSession: (wordsPerSession) => set({ wordsPerSession }),
      setTransitionDelay: (transitionDelay) => set({ transitionDelay }),
      setTransitionType: (transitionType) => set({ transitionType }),
      setSafeRound: (round, type) => set({ [`safeRound${round}`]: type } as Pick<SettingsState, 'safeRound1' | 'safeRound2' | 'safeRound3'>),
      setAutoPlayAudio: (autoPlayAudio) => set({ autoPlayAudio }),
      setWordsOnly: (wordsOnly) => set({ wordsOnly }),
      setLeitnerDay: (box, days) =>
        set((state) => {
          const next = [...state.leitnerDays] as [number, number, number, number, number, number, number]
          next[box] = days
          return { leitnerDays: next }
        }),
    }),
    { name: 'vocabox-settings' }
  )
)
