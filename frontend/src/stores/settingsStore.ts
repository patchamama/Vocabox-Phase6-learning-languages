import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ReviewMode = 'simple' | 'safe'

interface SettingsState {
  reviewMode: ReviewMode
  wordsPerSession: number
  setReviewMode: (mode: ReviewMode) => void
  setWordsPerSession: (n: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      reviewMode: 'simple',
      wordsPerSession: 20,
      setReviewMode: (reviewMode) => set({ reviewMode }),
      setWordsPerSession: (wordsPerSession) => set({ wordsPerSession }),
    }),
    { name: 'vocabox-settings' }
  )
)
