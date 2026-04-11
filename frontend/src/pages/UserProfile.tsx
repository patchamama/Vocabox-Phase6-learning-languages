import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/authStore'
import { useUserProfileStore } from '../stores/userProfileStore'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n'

function Toggle({ value, onChange, label, description }: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/40 hover:border-slate-400 dark:hover:border-slate-500 transition-all text-left"
    >
      <div>
        <div className="font-medium text-slate-900 dark:text-white text-sm">{label}</div>
        {description && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</div>}
      </div>
      <div className={`w-11 h-6 rounded-full transition-colors shrink-0 ml-3 relative ${value ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${value ? 'left-6' : 'left-1'}`} />
      </div>
    </button>
  )
}

const LANG_FLAGS: Record<SupportedLanguage, string> = {
  es: '🇦🇷',
  en: '🇺🇸',
  de: '🇩🇪',
  fr: '🇫🇷',
  it: '🇮🇹',
}

export default function UserProfile() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const {
    displayName, uiLanguage,
    notificationsEmail, notificationsPush, darkMode,
    setDisplayName, setUiLanguage,
    setNotificationsEmail, setNotificationsPush, setDarkMode,
  } = useUserProfileStore()

  const [localName, setLocalName] = useState(displayName)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setDisplayName(localName.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="p-4 pt-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="text-slate-400 hover:text-slate-200 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M11.03 3.97a.75.75 0 0 1 0 1.06l-6.22 6.22H21a.75.75 0 0 1 0 1.5H4.81l6.22 6.22a.75.75 0 1 1-1.06 1.06l-7.5-7.5a.75.75 0 0 1 0-1.06l7.5-7.5a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
      </div>

      {/* Avatar + username */}
      <div className="flex items-center gap-4 card">
        <div className="w-14 h-14 rounded-full bg-blue-500/20 border-2 border-blue-500/40 flex items-center justify-center text-2xl">
          {(displayName || user?.username || '?')[0].toUpperCase()}
        </div>
        <div>
          <div className="font-semibold text-slate-900 dark:text-white">{displayName || user?.username}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">@{user?.username}</div>
          <div className="text-xs text-slate-400 dark:text-slate-500">{user?.email}</div>
        </div>
      </div>

      {/* Personal data */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('profile.displayName')}</h2>
        <input
          type="text"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          placeholder={t('profile.displayNamePlaceholder')}
          className="input w-full"
        />
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('profile.username')}</label>
          <input
            type="text"
            value={user?.username ?? ''}
            disabled
            className="input w-full opacity-50 cursor-not-allowed"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('profile.email')}</label>
          <input
            type="email"
            value={user?.email ?? ''}
            disabled
            className="input w-full opacity-50 cursor-not-allowed"
          />
        </div>
      </div>

      {/* App language */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('profile.preferredLanguage')}</h2>
        <div className="grid grid-cols-5 gap-2">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang}
              onClick={() => setUiLanguage(lang)}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border-2 text-xs font-medium transition-all ${
                uiLanguage === lang
                  ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                  : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              <span className="text-xl">{LANG_FLAGS[lang]}</span>
              <span className="uppercase">{lang}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('profile.notifications')}</h2>
        <Toggle
          value={notificationsEmail}
          onChange={setNotificationsEmail}
          label={t('profile.notificationsEmail')}
          description={t('profile.notificationsEmailDesc')}
        />
        <Toggle
          value={notificationsPush}
          onChange={setNotificationsPush}
          label={t('profile.notificationsPush')}
          description={t('profile.notificationsPushDesc')}
        />
      </div>

      {/* Appearance */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('profile.theme')}</h2>
        <Toggle
          value={darkMode}
          onChange={setDarkMode}
          label={t('profile.darkMode')}
          description={t('profile.darkModeDesc')}
        />
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        className="btn-primary w-full"
      >
        {saved ? `✓ ${t('profile.saved')}` : t('profile.save')}
      </button>
    </div>
  )
}
