import { create } from 'zustand'

interface AddWordPrefill {
  palabra: string
  significado: string
}

interface AddWordState {
  prefill: AddWordPrefill | null
  setPrefill: (data: AddWordPrefill) => void
  clearPrefill: () => void
}

export const useAddWordStore = create<AddWordState>((set) => ({
  prefill: null,
  setPrefill: (data) => set({ prefill: data }),
  clearPrefill: () => set({ prefill: null }),
}))
