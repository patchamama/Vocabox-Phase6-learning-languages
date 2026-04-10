import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ReviewMode = 'simple' | 'safe'
export type TransitionType = 'auto' | 'button'
export type RoundType = 'pair_match' | 'first_letter' | 'anagram' | 'write' | 'multiple_choice' | 'random'

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

  setReviewMode: (mode: ReviewMode) => void
  setWordsPerSession: (n: number) => void
  setTransitionDelay: (s: number) => void
  setTransitionType: (t: TransitionType) => void
  setSafeRound: (round: 1 | 2 | 3, type: RoundType) => void
  setAutoPlayAudio: (v: boolean) => void
  setWordsOnly: (v: boolean) => void
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
      setReviewMode: (reviewMode) => set({ reviewMode }),
      setWordsPerSession: (wordsPerSession) => set({ wordsPerSession }),
      setTransitionDelay: (transitionDelay) => set({ transitionDelay }),
      setTransitionType: (transitionType) => set({ transitionType }),
      setSafeRound: (round, type) => set({ [`safeRound${round}`]: type } as Pick<SettingsState, 'safeRound1' | 'safeRound2' | 'safeRound3'>),
      setAutoPlayAudio: (autoPlayAudio) => set({ autoPlayAudio }),
      setWordsOnly: (wordsOnly) => set({ wordsOnly }),
    }),
    { name: 'vocabox-settings' }
  )
)
