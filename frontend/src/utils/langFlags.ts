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

export function langFlag(code: string): string {
  return LANG_FLAGS[code] ?? code.toUpperCase().slice(0, 2)
}

export function langPair(origin: string, dest: string): string {
  return `${langFlag(origin)} → ${langFlag(dest)}`
}
