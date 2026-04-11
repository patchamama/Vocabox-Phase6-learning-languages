import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import es from './locales/es.json'
import en from './locales/en.json'
import de from './locales/de.json'
import fr from './locales/fr.json'
import it from './locales/it.json'

export const SUPPORTED_LANGUAGES = ['es', 'en', 'de', 'fr', 'it'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

const savedLang = localStorage.getItem('vocabox-ui-lang') as SupportedLanguage | null
const browserLang = navigator.language.slice(0, 2) as SupportedLanguage
const defaultLang: SupportedLanguage =
  savedLang && SUPPORTED_LANGUAGES.includes(savedLang)
    ? savedLang
    : SUPPORTED_LANGUAGES.includes(browserLang)
      ? browserLang
      : 'es'

i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en }, de: { translation: de }, fr: { translation: fr }, it: { translation: it } },
  lng: defaultLang,
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
})

export default i18n
