import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi } from '../api/client'
import type { User } from '../types'

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  error: string | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,

      login: async (username, password) => {
        set({ isLoading: true, error: null })
        try {
          const { data: tokenData } = await authApi.login(username, password)
          localStorage.setItem('token', tokenData.access_token)
          const { data: user } = await authApi.me()
          set({ token: tokenData.access_token, user, isLoading: false })
        } catch (err: unknown) {
          const msg =
            err instanceof Error
              ? err.message
              : (err as { response?: { data?: { detail?: string } } })?.response?.data
                  ?.detail ?? 'Error al iniciar sesión'
          set({ error: msg, isLoading: false })
          throw err
        }
      },

      register: async (username, email, password) => {
        set({ isLoading: true, error: null })
        try {
          await authApi.register(username, email, password)
          const { data: tokenData } = await authApi.login(username, password)
          localStorage.setItem('token', tokenData.access_token)
          const { data: user } = await authApi.me()
          set({ token: tokenData.access_token, user, isLoading: false })
        } catch (err: unknown) {
          const msg =
            err instanceof Error
              ? err.message
              : (err as { response?: { data?: { detail?: string } } })?.response?.data
                  ?.detail ?? 'Error al registrarse'
          set({ error: msg, isLoading: false })
          throw err
        }
      },

      logout: () => {
        localStorage.removeItem('token')
        set({ user: null, token: null })
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'vocabox-auth',
      partialize: (s) => ({ user: s.user, token: s.token }),
    }
  )
)
