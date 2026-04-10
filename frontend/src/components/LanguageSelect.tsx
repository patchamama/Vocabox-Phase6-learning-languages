import type { Language } from '../types'

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
      {languages.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name_es ?? l.code}
        </option>
      ))}
    </select>
  )
}
