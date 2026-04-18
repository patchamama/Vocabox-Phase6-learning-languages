import { create } from 'zustand'
import { GrammarQueueItem, grammarQueueApi } from '../api/client'

interface GrammarQueueState {
  items: GrammarQueueItem[]
  workerRunning: boolean
  loading: boolean
  grammarCheckEnabled: boolean

  setItems: (items: GrammarQueueItem[]) => void
  upsertItem: (item: GrammarQueueItem) => void
  removeItem: (id: number) => void
  setWorkerRunning: (running: boolean) => void
  setGrammarCheckEnabled: (enabled: boolean) => void

  fetchQueue: () => Promise<void>
  resumeWorker: () => Promise<void>
  stopWorker: () => Promise<void>
  deleteItem: (id: number) => Promise<void>
}

export const useGrammarQueueStore = create<GrammarQueueState>((set, get) => ({
  items: [],
  workerRunning: false,
  loading: false,
  grammarCheckEnabled: true,

  setItems: (items) => set({ items }),

  upsertItem: (item) =>
    set((state) => {
      const idx = state.items.findIndex((i) => i.id === item.id)
      if (idx === -1) return { items: [...state.items, item] }
      const next = [...state.items]
      next[idx] = item
      return { items: next }
    }),

  removeItem: (id) =>
    set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

  setWorkerRunning: (running) => set({ workerRunning: running }),

  setGrammarCheckEnabled: (enabled) => set({ grammarCheckEnabled: enabled }),

  fetchQueue: async () => {
    set({ loading: true })
    try {
      const res = await grammarQueueApi.list()
      set({ items: res.data.items, workerRunning: res.data.worker_running })
    } finally {
      set({ loading: false })
    }
  },

  resumeWorker: async () => {
    await grammarQueueApi.resume()
    set({ workerRunning: true })
  },

  stopWorker: async () => {
    await grammarQueueApi.stop()
    set({ workerRunning: false })
  },

  deleteItem: async (id) => {
    await grammarQueueApi.delete(id)
    get().removeItem(id)
  },
}))
