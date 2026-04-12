/**
 * Strip diacritics from a single character so that
 * 'a' matches 'á', 'e' matches 'é', etc.
 */
export function stripAccent(ch: string): string {
  return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Given the key the user pressed and the expected character,
 * return true if they match ignoring accents/diacritics.
 * Both sides are lowercased before comparison.
 */
export function accentInsensitiveMatch(typed: string, expected: string): boolean {
  return stripAccent(typed.toLowerCase()) === stripAccent(expected.toLowerCase())
}
