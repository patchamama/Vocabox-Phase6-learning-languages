import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { audioReviewApi } from '../api/client'
import { playAudio } from '../utils/audioManager'
import { useSettingsStore } from '../stores/settingsStore'

interface VoiceEntry {
  name: string
  locale: string
}

interface LangVoices {
  voices: VoiceEntry[]
  default: string | null
  preview_text: string
}

interface VoicesResponse {
  platform: string
  languages: Record<string, LangVoices>
}

// Fixed set of 5 languages always shown
const FIXED_LANGS = ['de', 'es', 'en', 'fr', 'it'] as const

// Fallback preview texts if backend doesn't provide them
const FALLBACK_PREVIEW: Record<string, string> = {
  de: 'Guten Tag, wie geht es Ihnen?',
  es: 'Hola, ¿cómo estás hoy?',
  en: 'Hello, how are you today?',
  fr: 'Bonjour, comment allez-vous?',
  it: 'Ciao, come stai oggi?',
}

export function TtsVoiceSettings() {
  const { t } = useTranslation()
  const { ttsVoices, ttsRate, setTtsVoice, setTtsRate } = useSettingsStore()

  const [data, setData] = useState<VoicesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [playingLang, setPlayingLang] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    audioReviewApi
      .getVoices()
      .then((r) => setData(r.data as VoicesResponse))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  async function handlePreview(lang: string) {
    if (playingLang === lang) {
      audioRef.current?.pause()
      setPlayingLang(null)
      return
    }

    const langData = data?.languages[lang]
    const voice = ttsVoices[lang] || langData?.default || ''
    const previewText = langData?.preview_text || FALLBACK_PREVIEW[lang] || 'Hello'

    setPlayingLang(lang)
    try {
      const res = await audioReviewApi.previewVoice(lang, voice, ttsRate, previewText)
      const blob = new Blob([res.data], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      playAudio(audio)
      audio.onended = () => { setPlayingLang(null); URL.revokeObjectURL(url) }
      audio.onerror = () => { setPlayingLang(null); URL.revokeObjectURL(url) }
    } catch {
      setPlayingLang(null)
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-400">{t('common.loading')}</p>
  }

  return (
    <div className="space-y-4">
      {/* Speech rate */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-200">{t('settings.ttsRate')}</p>
          <p className="text-xs text-zinc-400">{t('settings.ttsRateDesc')}</p>
        </div>
        <div className="flex items-center gap-3 min-w-[220px]">
          <span className="text-xs text-zinc-400 w-8 text-right">🐢</span>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={ttsRate}
            onChange={(e) => setTtsRate(parseFloat(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs text-zinc-400 w-6">🐇</span>
          <span className="text-xs text-zinc-300 w-10 text-right font-mono">
            {ttsRate.toFixed(1)}×
          </span>
        </div>
      </div>

      {/* Voice per language — always show all 5 */}
      <div className="space-y-3">
        {FIXED_LANGS.map((lang) => {
          const langData = data?.languages[lang]
          const voices = langData?.voices ?? []
          const selectedVoice = ttsVoices[lang] || langData?.default || ''
          const isPlaying = playingLang === lang
          const hasVoices = voices.length > 0

          return (
            <div key={lang} className="flex items-center gap-3">
              {/* Language badge */}
              <span className="text-xs font-mono bg-zinc-700 text-zinc-300 rounded px-2 py-0.5 uppercase w-8 text-center shrink-0">
                {lang}
              </span>

              {/* Voice selector or placeholder */}
              {hasVoices ? (
                <select
                  value={selectedVoice}
                  onChange={(e) => setTtsVoice(lang, e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-600 text-zinc-200 text-sm rounded px-2 py-1"
                >
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.locale})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="flex-1 text-xs text-zinc-500 italic px-2">
                  {t('settings.ttsNoVoices')}
                </span>
              )}

              {/* Preview button */}
              <button
                type="button"
                onClick={() => handlePreview(lang)}
                disabled={!hasVoices}
                className={`text-xs px-3 py-1 rounded transition-colors shrink-0 ${
                  isPlaying
                    ? 'bg-blue-600 text-white'
                    : hasVoices
                      ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
              >
                {isPlaying ? '⏸' : '▶'} {t('settings.ttsPreview')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
