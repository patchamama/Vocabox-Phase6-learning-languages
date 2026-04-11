import type { Language } from '../types'

const LANG_FLAGS: Record<string, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  de: '🇩🇪',
  fr: '🇫🇷',
  it: '🇮🇹',
  pt: '🇵🇹',
  ja: '🇯🇵',
  zh: '🇨🇳',
  ko: '🇰🇷',
  ru: '🇷🇺',
  ar: '🇸🇦',
  nl: '🇳🇱',
  pl: '🇵🇱',
  sv: '🇸🇪',
  tr: '🇹🇷',
}

interface LanguageSelectProps {
  languages: Language[]
  value: string
  onChange: (code: string) => void
  className?: string
}

export default function LanguageSelect({
  languages,
  value,
  onChange,
  className,
}: LanguageSelectProps) {
  return (
    <select
      className={className ?? 'input'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {languages.map((l) => {
        const flag = LANG_FLAGS[l.code] ?? ''
        const code = l.code.toUpperCase().slice(0, 2)
        return (
          <option key={l.code} value={l.code}>
            {flag} {code}
          </option>
        )
      })}
    </select>
  )
}
