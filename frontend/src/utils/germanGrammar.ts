/**
 * germanGrammar.ts — Runtime parsing of German grammar elements
 * from palabra/significado strings stored in the dictionary.
 *
 * Articles are embedded in `palabra` (e.g. "der Hund | Substantiv | die Hunde | Tier").
 * This module extracts them without any DB changes.
 */

export type GermanArticle = 'der' | 'die' | 'das'

export type GrammarBlank = {
  type: 'declension' | 'preposition' | 'adj_ending' | 'verb_prep'
  original: string    // the actual token in the text (e.g. "dem")
  options: string[]   // choices to show (correct one included)
  displayText: string // text with blank: "Ich helfe ___ Mann"
  tipKey: string      // key into germanGrammarTips
}

// ── Article detection ─────────────────────────────────────────────────────────

const ARTICLE_REGEX = /^(der|die|das)\s+/i

/**
 * Extract definite article and clean noun from a palabra string.
 * Handles pipe-separated metadata: "der Hund | Substantiv | die Hunde | Tier"
 */
export function extractArticle(
  palabra: string
): { article: GermanArticle; noun: string } | null {
  // Take only the first segment before any pipe
  const base = palabra.split('|')[0].trim()
  const match = base.match(ARTICLE_REGEX)
  if (!match) return null
  const article = match[1].toLowerCase() as GermanArticle
  const noun = base.slice(match[0].length).trim()
  if (!noun) return null
  return { article, noun }
}

// ── Declined article / preposition detection ──────────────────────────────────

// All declined forms of definite + indefinite articles
const DECLINED_DEFINITE = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des',
])

const DECLINED_INDEFINITE = new Set([
  'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines',
  'mein', 'meine', 'meinen', 'meinem', 'meiner', 'meines',
  'dein', 'deine', 'deinen', 'deinem', 'deiner', 'deines',
  'sein', 'seine', 'seinen', 'seinem', 'seiner', 'seines',
  'ihr', 'ihre', 'ihren', 'ihrem', 'ihrer', 'ihres',
  'unser', 'unsere', 'unseren', 'unserem', 'unserer', 'unseres',
])

// Prepositions with fixed case
const PREPOSITIONS_AKK = new Set(['durch', 'für', 'gegen', 'ohne', 'um', 'bis', 'entlang'])
const PREPOSITIONS_DAT = new Set(['aus', 'bei', 'gegenüber', 'mit', 'nach', 'seit', 'von', 'zu', 'außer', 'ab'])
// const PREPOSITIONS_GEN = new Set(['wegen', 'trotz', 'während', 'statt', 'anstatt', 'aufgrund', 'infolge'])
const WECHSELPRAEP = new Set(['an', 'auf', 'in', 'über', 'unter', 'vor', 'hinter', 'neben', 'zwischen'])

// Fixed verb-preposition pairs
const VERB_PREPS: Array<{ verb: string; prep: string }> = [
  { verb: 'warten', prep: 'auf' },
  { verb: 'denken', prep: 'an' },
  { verb: 'freuen', prep: 'auf' },
  { verb: 'fragen', prep: 'nach' },
  { verb: 'suchen', prep: 'nach' },
  { verb: 'achten', prep: 'auf' },
  { verb: 'antworten', prep: 'auf' },
  { verb: 'verzichten', prep: 'auf' },
  { verb: 'bestehen', prep: 'auf' },
  { verb: 'erinnern', prep: 'an' },
  { verb: 'gewöhnen', prep: 'an' },
  { verb: 'interessieren', prep: 'für' },
  { verb: 'danken', prep: 'für' },
  { verb: 'sorgen', prep: 'für' },
  { verb: 'sprechen', prep: 'über' },
  { verb: 'nachdenken', prep: 'über' },
  { verb: 'teilnehmen', prep: 'an' },
  { verb: 'gehören', prep: 'zu' },
  { verb: 'einladen', prep: 'zu' },
]

// Options for article blanks
const DEFINITE_OPTIONS = ['der', 'die', 'das', 'den', 'dem', 'des']
const SIMPLE_ARTICLE_OPTIONS: GermanArticle[] = ['der', 'die', 'das']

/**
 * Detect first grammar-sensitive element in a phrase.
 * Returns a GrammarBlank describing it, or null if nothing detectable.
 *
 * Only runs for German source words that are multi-word (phrases).
 */
export function detectGrammarBlank(text: string): GrammarBlank | null {
  // Take only first pipe segment
  const base = text.split('|')[0].trim()
  const words = base.split(/\s+/)
  if (words.length < 2) return null

  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase().replace(/[.,!?;:]$/, '')

    // Check declined definite article (not at position 0, to avoid the noun article)
    if (i > 0 && DECLINED_DEFINITE.has(w)) {
      const blank = _makeBlank(words, i, DEFINITE_OPTIONS.filter(o => o !== w).slice(0, 3).concat([w]), w)
      return {
        type: 'declension',
        original: w,
        options: _shuffleOptions(DEFINITE_OPTIONS.slice(0, 4), w),
        displayText: blank,
        tipKey: _caseFromForm(w),
      }
    }

    // Check declined indefinite article
    if (DECLINED_INDEFINITE.has(w)) {
      const options = _shuffleOptions(['ein', 'eine', 'einen', 'einem'], w)
      return {
        type: 'declension',
        original: w,
        options,
        displayText: _makeBlank(words, i, options, w),
        tipKey: 'accusative',
      }
    }

    // Check wechselpräposition
    if (WECHSELPRAEP.has(w)) {
      const options = _shuffleOptions([...WECHSELPRAEP].slice(0, 4), w)
      return {
        type: 'preposition',
        original: w,
        options,
        displayText: _makeBlank(words, i, options, w),
        tipKey: 'wechselpraep',
      }
    }

    // Check fixed case prepositions
    if (PREPOSITIONS_DAT.has(w) || PREPOSITIONS_AKK.has(w)) {
      const pool = [...PREPOSITIONS_DAT, ...PREPOSITIONS_AKK].slice(0, 4)
      const options = _shuffleOptions(pool, w)
      return {
        type: 'preposition',
        original: w,
        options,
        displayText: _makeBlank(words, i, options, w),
        tipKey: PREPOSITIONS_DAT.has(w) ? 'dativ_praep' : 'akkusativ_praep',
      }
    }

    // Check verb-prep pairs (look at current word as verb, next as prep)
    if (i + 1 < words.length) {
      const nextW = words[i + 1].toLowerCase().replace(/[.,!?;:]$/, '')
      const pair = VERB_PREPS.find(vp => vp.verb === w && vp.prep === nextW)
      if (pair) {
        const prepOptions = _shuffleOptions(['auf', 'an', 'für', 'nach', 'über', 'zu'].slice(0, 4), pair.prep)
        return {
          type: 'verb_prep',
          original: pair.prep,
          options: prepOptions,
          displayText: _makeBlank(words, i + 1, prepOptions, pair.prep),
          tipKey: 'verb_preps',
        }
      }
    }
  }

  return null
}

function _makeBlank(words: string[], idx: number, _options: string[], original: string): string {
  const result = [...words]
  // Preserve any trailing punctuation from the original word
  const trailing = words[idx].slice(original.length)
  result[idx] = '___' + trailing
  return result.join(' ')
}

function _shuffleOptions(pool: string[], correct: string): string[] {
  // Ensure correct is in pool, pick up to 4, shuffle
  const filtered = pool.filter((o, i, arr) => arr.indexOf(o) === i) // dedupe
  if (!filtered.includes(correct)) filtered.push(correct)
  const picked = filtered.slice(0, 4)
  if (!picked.includes(correct)) picked[picked.length - 1] = correct
  // Fisher-Yates
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[picked[i], picked[j]] = [picked[j], picked[i]]
  }
  return picked
}

function _caseFromForm(form: string): string {
  switch (form) {
    case 'den': return 'accusative'
    case 'dem': return 'dative'
    case 'des': return 'genitive'
    default: return 'nominative'
  }
}

/**
 * Returns true if the word is a German noun with a detectable article.
 * Used to decide whether to inject a german_article exercise.
 */
export function isGermanNounWithArticle(
  idioma_origen: string,
  _categoria: string | null | undefined,
  palabra: string
): boolean {
  if (idioma_origen !== 'de') return false
  // Check article in palabra string (most reliable)
  return extractArticle(palabra) !== null
}

/**
 * Returns true if the phrase has detectable grammar blanks.
 */
export function isGermanPhraseWithGrammar(
  idioma_origen: string,
  palabra: string
): boolean {
  if (idioma_origen !== 'de') return false
  const base = palabra.split('|')[0].trim()
  if (base.split(/\s+/).length < 2) return false
  return detectGrammarBlank(base) !== null
}

export { SIMPLE_ARTICLE_OPTIONS }
