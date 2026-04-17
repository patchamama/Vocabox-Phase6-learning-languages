/**
 * WordDrillModal — quick flashcard drill for filtered words (no box changes).
 *
 * Shows words one by one. User reveals answer and self-assesses ✓/✗.
 * At the end offers "Practicar gramática" which launches GrammarSession.
 */

import { useState, useMemo } from 'react'
import type { UserWord } from '../types'
import type { ReviewWord } from '../types'
import GrammarSession from './GrammarSession'
import type { TipLang } from '../data/germanGrammarTips'

interface Props {
  words: UserWord[]
  uiLang?: TipLang
  onClose: () => void
}

function userWordToReviewWord(uw: UserWord): ReviewWord {
  return {
    user_word_id: uw.id,
    word_id: uw.word.id,
    palabra: uw.word.palabra,
    significado: uw.word.significado,
    idioma_origen: uw.word.idioma_origen,
    idioma_destino: uw.word.idioma_destino,
    box_level: uw.box_level,
    audio_url: uw.word.audio_url,
    audio_url_translation: uw.word.audio_url_translation,
    exercise_type: 'multiple_choice',
    choices: null,
    tema_id: uw.word.tema_id,
    tema_nombre: uw.word.tema?.nombre ?? null,
    tema_color: uw.word.tema?.color ?? null,
  }
}

export default function WordDrillModal({ words, uiLang = 'es', onClose }: Props) {
  const [idx, setIdx] = useState(0)
  const [revealed, setReveal] = useState(false)
  const [correct, setCorrect] = useState(0)
  const [done, setDone] = useState(false)
  const [showGrammar, setShowGrammar] = useState(false)

  // Shuffle once on mount
  const shuffled = useMemo(() => {
    const arr = [...words]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }, [words])

  const total = shuffled.length
  const current = shuffled[idx]

  const answer = (ok: boolean) => {
    if (ok) setCorrect((c) => c + 1)
    if (idx + 1 >= total) {
      setDone(true)
    } else {
      setIdx((i) => i + 1)
      setReveal(false)
    }
  }

  const reviewWords = useMemo(() => shuffled.map(userWordToReviewWord), [shuffled])

  const L = {
    title: { es: 'Repaso rápido', en: 'Quick review', de: 'Schnelle Wiederholung', fr: 'Révision rapide' },
    reveal: { es: 'Ver respuesta', en: 'Reveal answer', de: 'Antwort zeigen', fr: 'Voir la réponse' },
    correct: { es: '✓ Correcto', en: '✓ Correct', de: '✓ Richtig', fr: '✓ Correct' },
    wrong: { es: '✗ Incorrecto', en: '✗ Wrong', de: '✗ Falsch', fr: '✗ Incorrect' },
    score: { es: 'Resultado', en: 'Score', de: 'Ergebnis', fr: 'Résultat' },
    again: { es: 'Repetir', en: 'Repeat', de: 'Wiederholen', fr: 'Répéter' },
    grammar: { es: 'Practicar gramática →', en: 'Practice grammar →', de: 'Grammatik üben →', fr: 'Pratiquer la grammaire →' },
    close: { es: 'Cerrar', en: 'Close', de: 'Schließen', fr: 'Fermer' },
    progress: { es: 'de', en: 'of', de: 'von', fr: 'sur' },
    meaning: { es: 'Significado', en: 'Meaning', de: 'Bedeutung', fr: 'Sens' },
  }
  const t = (key: keyof typeof L) => (L[key][uiLang] ?? L[key].es) as string

  if (showGrammar) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
        <div className="flex-1 overflow-y-auto max-w-lg mx-auto w-full pb-4 px-4">
          <GrammarSession words={reviewWords} uiLang={uiLang} onDone={onClose} />
        </div>
      </div>
    )
  }

  if (done) {
    const pct = Math.round((correct / total) * 100)
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/95 flex items-center justify-center p-4">
        <div className="card w-full max-w-sm space-y-5 text-center animate-slide-up">
          <div className="text-4xl">{pct >= 80 ? '🎉' : pct >= 50 ? '👍' : '💪'}</div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">{t('score')}</p>
            <p className="text-3xl font-bold text-white">{correct}/{total}</p>
            <p className="text-slate-400 text-sm mt-1">{pct}%</p>
          </div>
          <div className="space-y-2 pt-2">
            <button
              onClick={() => setShowGrammar(true)}
              className="w-full py-3 btn-primary text-sm"
            >
              ✏️ {t('grammar')}
            </button>
            <button
              onClick={() => { setIdx(0); setReveal(false); setCorrect(0); setDone(false) }}
              className="w-full py-2 btn-secondary text-sm"
            >
              🔄 {t('again')}
            </button>
            <button onClick={onClose} className="w-full py-2 btn-secondary text-sm">
              {t('close')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/95 flex flex-col items-center justify-start p-4 pt-8">
      {/* Header */}
      <div className="w-full max-w-sm flex items-center justify-between mb-4">
        <p className="text-sm text-slate-400 font-medium">
          {t('title')} — {idx + 1} {t('progress')} {total}
        </p>
        <button onClick={onClose} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-sm h-1 bg-slate-700 rounded-full mb-5">
        <div
          className="h-1 bg-blue-500 rounded-full transition-all"
          style={{ width: `${((idx) / total) * 100}%` }}
        />
      </div>

      {/* Card */}
      <div className="w-full max-w-sm space-y-4 animate-slide-up">
        {/* Front */}
        <div className="card text-center space-y-2">
          {current.word.tema && (
            <span
              className="inline-block text-xs px-2 py-0.5 rounded-full font-medium text-white mb-1"
              style={{ backgroundColor: current.word.tema.color }}
            >
              {current.word.tema.nombre}
            </span>
          )}
          <p className="text-3xl font-bold text-white break-words leading-tight">
            {current.word.palabra}
          </p>
          <p className="text-xs text-slate-500">
            {current.word.idioma_origen} → {current.word.idioma_destino}
          </p>
        </div>

        {/* Reveal / Answer */}
        {!revealed ? (
          <button
            onClick={() => setReveal(true)}
            className="btn-secondary w-full py-3 text-sm"
          >
            👁 {t('reveal')}
          </button>
        ) : (
          <>
            <div className="card text-center space-y-1 border border-slate-600">
              <p className="text-xs text-slate-400 uppercase tracking-widest">{t('meaning')}</p>
              <p className="text-xl font-semibold text-white break-words">
                {current.word.significado}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => answer(false)}
                className="flex-1 py-3 rounded-xl border-2 border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 font-medium text-sm transition-colors"
              >
                {t('wrong')}
              </button>
              <button
                onClick={() => answer(true)}
                className="flex-1 py-3 rounded-xl border-2 border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20 font-medium text-sm transition-colors"
              >
                {t('correct')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
