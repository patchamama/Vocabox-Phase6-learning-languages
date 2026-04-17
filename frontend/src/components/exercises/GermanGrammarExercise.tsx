import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReviewWord } from '../../types'
import type { GrammarBlank } from '../../utils/germanGrammar'
import { getTip } from '../../data/germanGrammarTips'
import GrammarTipModal from '../GrammarTipModal'
import type { TipLang } from '../../data/germanGrammarTips'

interface Props {
  word: ReviewWord
  blank: GrammarBlank
  onAnswer: (correct: boolean, userInput: string) => void
  uiLang?: TipLang
}

export default function GermanGrammarExercise({
  word,
  blank,
  onAnswer,
  uiLang = 'es',
}: Props) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const [showTip, setShowTip] = useState(false)

  useEffect(() => {
    setSelected(null)
  }, [word.user_word_id])

  const pick = (option: string) => {
    if (selected) return
    setSelected(option)
    setTimeout(() => onAnswer(option === blank.original, option), 900)
  }

  const choiceClass = (option: string) => {
    if (!selected) return 'bg-slate-700 hover:bg-slate-600 border-slate-600 cursor-pointer'
    if (option === blank.original) return 'bg-green-500/20 border-green-500 text-green-200'
    if (option === selected) return 'bg-red-500/20 border-red-500 text-red-200'
    return 'bg-slate-700 border-slate-600 opacity-40'
  }

  const tip = getTip(blank.tipKey)

  // Render displayText with highlighted blank
  const renderDisplay = () => {
    const parts = blank.displayText.split('___')
    if (parts.length === 1) return <span>{blank.displayText}</span>
    return (
      <>
        {parts[0]}
        <span
          className={`inline-block min-w-[3rem] border-b-2 mx-1 text-center font-bold ${
            selected
              ? selected === blank.original
                ? 'border-green-400 text-green-300'
                : 'border-red-400 text-red-300'
              : 'border-blue-400 text-blue-300'
          }`}
        >
          {selected ?? '___'}
        </span>
        {parts.slice(1).join('___')}
      </>
    )
  }

  const typeLabel = {
    declension: { es: 'Declinación', en: 'Declension', de: 'Deklination', fr: 'Déclinaison' },
    preposition: { es: 'Preposición', en: 'Preposition', de: 'Präposition', fr: 'Préposition' },
    adj_ending: { es: 'Declinación de adjetivo', en: 'Adjective ending', de: 'Adjektivendung', fr: 'Terminaison adj.' },
    verb_prep: { es: 'Preposición verbal', en: 'Verb preposition', de: 'Verbpräposition', fr: 'Prép. verbale' },
  }[blank.type][uiLang] ?? blank.type

  return (
    <div className="space-y-5 animate-slide-up">
      {showTip && tip && (
        <GrammarTipModal tip={tip} lang={uiLang} onClose={() => setShowTip(false)} />
      )}

      <div className="card relative">
        {/* Grammar tip button */}
        <button
          onClick={() => setShowTip(true)}
          className="absolute top-2 right-2 text-slate-500 hover:text-yellow-400 transition-colors text-lg"
          title="Tip de gramática"
        >
          💡
        </button>

        {/* Type label */}
        <p className="text-xs text-blue-400 uppercase tracking-wide mb-3">{typeLabel}</p>

        {/* Phrase with blank */}
        <p className="font-medium text-xl text-white leading-relaxed mb-3">
          {renderDisplay()}
        </p>

        {/* Significado as context */}
        <p className="text-slate-400 text-sm">{word.significado}</p>
      </div>

      {/* Options */}
      <div className="flex flex-wrap gap-2">
        {blank.options.map((opt) => (
          <button
            key={opt}
            onClick={() => pick(opt)}
            className={`px-4 py-2 rounded-xl border-2 font-medium text-sm transition-all duration-200 ${choiceClass(opt)}`}
          >
            {opt}
          </button>
        ))}
      </div>

      {!selected && (
        <button
          type="button"
          onClick={() => onAnswer(false, '')}
          className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors pt-1"
        >
          <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-slate-600 text-[9px] font-mono text-slate-500 mr-1">Esc</kbd>
          {t('settings.exercises.dontKnow')}
        </button>
      )}
    </div>
  )
}
