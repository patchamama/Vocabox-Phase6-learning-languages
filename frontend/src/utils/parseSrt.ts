export interface SrtEntry {
  index: number
  start: number  // seconds
  end: number    // seconds
  text: string
  lang?: string  // e.g. "de", "es", "en" — parsed from [lang:xx] metadata line
}

function parseSrtTime(s: string): number {
  // HH:MM:SS,mmm
  const [hms, ms] = s.trim().split(',')
  const [h, m, sec] = hms.split(':').map(Number)
  return h * 3600 + m * 60 + sec + (parseInt(ms || '0', 10) / 1000)
}

const LANG_META_RE = /^\[lang:([a-z]{2})\]$/

export function parseSrt(text: string): SrtEntry[] {
  const entries: SrtEntry[] = []
  const blocks = text.trim().split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const index = parseInt(lines[0].trim(), 10)
    const timeParts = lines[1].split('-->')
    if (timeParts.length < 2) continue
    const start = parseSrtTime(timeParts[0])
    const end = parseSrtTime(timeParts[1])

    // Remaining lines: text + optional [lang:xx] metadata
    const contentLines = lines.slice(2)
    let lang: string | undefined
    const textLines = contentLines.filter((l) => {
      const m = l.trim().match(LANG_META_RE)
      if (m) { lang = m[1]; return false }
      return true
    })
    const entryText = textLines.join(' ').trim()

    if (!isNaN(index) && !isNaN(start) && !isNaN(end) && entryText) {
      entries.push({ index, start, end, text: entryText, lang })
    }
  }
  return entries
}
