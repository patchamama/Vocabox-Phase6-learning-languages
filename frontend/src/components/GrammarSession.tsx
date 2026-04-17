/**
 * GrammarSession — mini grammar practice session after a review.
 *
 * Takes the reviewed words, filters for German ones with detectable
 * grammar, builds a local queue of article-choice + grammar-blank exercises,
 * runs them in sequence, shows score at the end.
 *
 * No backend calls (educational only — no box changes).
 */

import { useState, useMemo } from 'react'
import type { ReviewWord } from '../types'
import {
  detectGrammarBlank,
  isGermanNounWithArticle,
  type GrammarBlank,
} from '../utils/germanGrammar'
import GermanArticleExercise from './exercises/GermanArticleExercise'
import GermanGrammarExercise from './exercises/GermanGrammarExercise'
import type { TipLang } from '../data/germanGrammarTips'

interface GrammarItem {
  kind: 'article' | 'grammar'
  word: ReviewWord
  blank?: GrammarBlank
}

interface Props {
  words: ReviewWord[]
  onDone: () => void
  uiLang?: TipLang
}

export default function GrammarSession({ words, onDone, uiLang = 'es' }: Props) {
  const [pos, setPos] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [done, setDone] = useState(false)

  const queue = useMemo<GrammarItem[]>(() => {
    const items: GrammarItem[] = []
    const deWords = words.filter((w) => w.idioma_origen === 'de')

    for (const word of deWords) {
      // Article exercise for nouns
      if (isGermanNounWithArticle(word.idioma_origen, null, word.palabra)) {
        items.push({ kind: 'article', word })
      }

      // Grammar blank for phrases
      const base = word.palabra.split('|')[0].trim()
      if (base.split(/\s+/).length >= 2) {
        const blank = detectGrammarBlank(base)
        if (blank) {
          items.push({ kind: 'grammar', word, blank })
        }
      }
    }

    // Shuffle
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[items[i], items[j]] = [items[j], items[i]]
    }

    return items
  }, [words])

  const total = queue.length

  const handleAnswer = (isCorrect: boolean) => {
    if (isCorrect) setCorrect((c) => c + 1)
    const next = pos + 1
    if (next >= total) {
      setDone(true)
    } else {
      setPos(next)
    }
  }

  if (total === 0) {
    return (
      <div className="space-y-6 text-center">
        <p className="text-slate-400 text-sm">
          {uiLang === 'de' ? 'Keine Grammatikübungen für diese Wörter gefunden.' :
           uiLang === 'en' ? 'No grammar exercises found for these words.' :
           uiLang === 'fr' ? 'Aucun exercice de grammaire trouvé pour ces mots.' :
           'No se encontraron ejercicios de gramática para estas palabras.'}
        </p>
        <button onClick={onDone} className="btn-primary">
          {uiLang === 'de' ? 'Fertig' : uiLang === 'en' ? 'Done' : uiLang === 'fr' ? 'Terminé' : 'Listo'}
        </button>
      </div>
    )
  }

  if (done) {
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0
    return (
      <div className="space-y-6 text-center animate-slide-up">
        <div className="text-5xl">{pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '📖'}</div>
        <div>
          <p className="text-xl font-bold text-white">
            {uiLang === 'de' ? 'Grammatik abgeschlossen!' :
             uiLang === 'en' ? 'Grammar completed!' :
             uiLang === 'fr' ? 'Grammaire terminée!' :
             '¡Gramática completada!'}
          </p>
          <p className="text-slate-400 mt-1">
            {correct}/{total} ({pct}%)
          </p>
        </div>

        <div className="flex justify-center gap-3">
          <button onClick={onDone} className="btn-secondary">
            {uiLang === 'de' ? 'Ergebnisse' : uiLang === 'en' ? 'Results' : uiLang === 'fr' ? 'Résultats' : 'Resultados'}
          </button>
        </div>
      </div>
    )
  }

  const item = queue[pos]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {uiLang === 'de' ? 'Grammatik' : uiLang === 'en' ? 'Grammar' : uiLang === 'fr' ? 'Grammaire' : 'Gramática'}
          {' '}· {pos + 1}/{total}
        </span>
        <span className="text-green-400">{correct} ✓</span>
      </div>

      {/* Progress bar */}
      <div className="bg-slate-700 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${((pos) / total) * 100}%` }}
        />
      </div>

      {/* Exercise */}
      {item.kind === 'article' ? (
        <GermanArticleExercise
          key={`${item.word.user_word_id}-article`}
          word={item.word}
          onAnswer={(ok, _input) => handleAnswer(ok)}
          uiLang={uiLang}
        />
      ) : item.blank ? (
        <GermanGrammarExercise
          key={`${item.word.user_word_id}-grammar`}
          word={item.word}
          blank={item.blank}
          onAnswer={(ok, _input) => handleAnswer(ok)}
          uiLang={uiLang}
        />
      ) : null}
    </div>
  )
}
