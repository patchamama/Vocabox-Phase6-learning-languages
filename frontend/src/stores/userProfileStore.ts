import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import i18n, { type SupportedLanguage } from '../i18n'

interface UserProfileState {
  displayName: string
  uiLanguage: SupportedLanguage
  notificationsEmail: boolean
  notificationsPush: boolean
  darkMode: boolean

  setDisplayName: (name: string) => void
  setUiLanguage: (lang: SupportedLanguage) => void
  setNotificationsEmail: (v: boolean) => void
  setNotificationsPush: (v: boolean) => void
  setDarkMode: (v: boolean) => void
}

export const useUserProfileStore = create<UserProfileState>()(
  persist(
    (set) => ({
      displayName: '',
      uiLanguage: (localStorage.getItem('vocabox-ui-lang') as SupportedLanguage) || 'es',
      notificationsEmail: false,
      notificationsPush: false,
      darkMode: true,

      setDisplayName: (displayName) => set({ displayName }),
      setUiLanguage: (uiLanguage) => {
        localStorage.setItem('vocabox-ui-lang', uiLanguage)
        i18n.changeLanguage(uiLanguage)
        set({ uiLanguage })
      },
      setNotificationsEmail: (notificationsEmail) => set({ notificationsEmail }),
      setNotificationsPush: (notificationsPush) => set({ notificationsPush }),
      setDarkMode: (darkMode) => {
        document.documentElement.classList.toggle('dark', darkMode)
        set({ darkMode })
      },
    }),
    { name: 'vocabox-user-profile' }
  )
)
