/**
 * TtsFiltersEditor — inline editor for per-language TTS regex filters.
 * Shows 5 fixed language tabs. On click, loads the filter file from the backend
 * (user override if exists, otherwise the base/default file).
 * User can edit, save, or restore the base file.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { audioReviewApi } from '../api/client'

const FIXED_LANGS = ['de', 'es', 'en', 'fr', 'it'] as const

export function TtsFiltersEditor() {
  const { t } = useTranslation()
  const [selectedLang, setSelectedLang] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [isUserOverride, setIsUserOverride] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function loadLang(lang: string) {
    setSelectedLang(lang)
    setLoading(true)
    setSaved(false)
    try {
      const { data } = await audioReviewApi.getTtsFilters(lang)
      setContent(data.content ?? '')
      setIsUserOverride(data.is_user_override ?? false)
    } catch {
      setContent('')
      setIsUserOverride(false)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!selectedLang) return
    setSaving(true)
    try {
      await audioReviewApi.putTtsFilters(selectedLang, content)
      setIsUserOverride(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleRestore() {
    if (!selectedLang) return
    setSaving(true)
    try {
      await audioReviewApi.deleteTtsFilters(selectedLang)
      await loadLang(selectedLang)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Language tabs */}
      <div className="flex gap-2 flex-wrap">
        {FIXED_LANGS.map((lang) => (
          <button
            key={lang}
            onClick={() => loadLang(lang)}
            className={`px-3 py-1.5 rounded-lg text-sm font-mono font-medium border-2 transition-all uppercase ${
              selectedLang === lang
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-400'
            }`}
          >
            {lang}
          </button>
        ))}
      </div>

      {/* Editor panel */}
      {selectedLang && (
        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-600">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isUserOverride
                ? t('settings.ttsFiltersCustom')
                : t('settings.ttsFiltersDefault')}
            </p>
            <div className="flex gap-2">
              {isUserOverride && (
                <button
                  onClick={handleRestore}
                  disabled={saving}
                  className="text-xs px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-400 transition-colors disabled:opacity-50"
                >
                  {t('settings.ttsFiltersRestore')}
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || loading}
                className="text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
              >
                {saved ? t('settings.ttsFiltersSaved') : t('settings.ttsFiltersSave')}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-xs text-slate-400">{t('common.loading')}</p>
          ) : (
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setSaved(false) }}
              rows={10}
              className="w-full font-mono text-xs bg-slate-900 border border-slate-600 rounded-xl p-3 text-slate-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="# one regex per line&#10;adj\\.&#10;\(.*?\)"
              spellCheck={false}
            />
          )}
          <p className="text-xs text-slate-500 dark:text-slate-500">
            {t('settings.ttsFiltersHint')}
          </p>
        </div>
      )}
    </div>
  )
}
