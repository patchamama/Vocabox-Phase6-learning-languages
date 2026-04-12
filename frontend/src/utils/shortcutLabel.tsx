import { stripAccent } from './normalize'

/**
 * Assign a unique Alt+key shortcut to each label string.
 * Prefers first char, then subsequent. Returns map: label → shortcut key (stripped lowercase).
 */
export function assignShortcuts(labels: string[]): Map<string, string> {
  const used = new Set<string>()
  const result = new Map<string, string>()
  for (const label of labels) {
    let assigned = ''
    for (const ch of label) {
      const key = stripAccent(ch.toLowerCase())
      if (key.length === 1 && /[a-z0-9]/.test(key) && !used.has(key)) {
        used.add(key)
        assigned = key
        break
      }
    }
    result.set(label, assigned)
  }
  return result
}

/**
 * Render text with the shortcut char highlighted.
 * Splits into [before, char, after] — no per-character spans, no spacing issues.
 * Optionally shows an "alt" kbd badge before the text.
 */
export function ShortcutLabel({ text, shortcut }: { text: string; shortcut: string }) {
  if (!shortcut) return <>{text}</>

  const chars = Array.from(text)
  const idx = chars.findIndex((ch) => stripAccent(ch.toLowerCase()) === shortcut)
  if (idx === -1) return <>{text}</>

  const before = chars.slice(0, idx).join('')
  const highlighted = chars[idx]
  const after = chars.slice(idx + 1).join('')

  return (
    <>
      {before}
      <u className="underline decoration-2 decoration-yellow-400 font-bold text-yellow-300 not-italic">
        {highlighted}
      </u>
      {after}
    </>
  )
}
