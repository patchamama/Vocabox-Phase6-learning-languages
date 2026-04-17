import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReviewWord } from '../../types'
import SpeakButton from '../SpeakButton'
import { langPair } from '../../utils/langFlags'
import { extractArticle, SIMPLE_ARTICLE_OPTIONS } from '../../utils/germanGrammar'
import { getTip } from '../../data/germanGrammarTips'
import GrammarTipModal from '../GrammarTipModal'
import type { TipLang } from '../../data/germanGrammarTips'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean, userInput: string) => void
  autoPlay?: boolean
  uiLang?: TipLang
}

export default function GermanArticleExercise({
  word,
  onAnswer,
  autoPlay = false,
  uiLang = 'es',
}: Props) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const [showTip, setShowTip] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const parsed = extractArticle(word.palabra)
  const correctArticle = parsed?.article ?? 'der'
  const noun = parsed?.noun ?? word.palabra

  const speak = () => {
    const url = word.audio_url
    if (url) {
      audioRef.current?.pause()
      audioRef.current = new Audio(url)
      audioRef.current.play().catch(() => {})
      return
    }
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(noun)
    u.lang = 'de'
    speechSynthesis.speak(u)
  }

  useEffect(() => {
    setSelected(null)
    if (!autoPlay) return
    speechSynthesis.cancel()
    audioRef.current?.pause()
    const timer = setTimeout(() => speak(), 150)
    return () => { clearTimeout(timer); speechSynthesis.cancel(); audioRef.current?.pause() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, autoPlay])

  const pick = (article: string) => {
    if (selected) return
    setSelected(article)
    setTimeout(() => onAnswer(article === correctArticle, article), 900)
  }

  const choiceClass = (article: string) => {
    if (!selected) return 'bg-slate-700 hover:bg-slate-600 border-slate-600 cursor-pointer'
    if (article === correctArticle) return 'bg-green-500/20 border-green-500 text-green-200'
    if (article === selected) return 'bg-red-500/20 border-red-500 text-red-200'
    return 'bg-slate-700 border-slate-600 opacity-40'
  }

  const tip = getTip('noun_article')

  return (
    <div className="space-y-5 animate-slide-up">
      {showTip && tip && (
        <GrammarTipModal tip={tip} lang={uiLang} onClose={() => setShowTip(false)} />
      )}

      <div className="card text-center relative">
        {/* Grammar tip button */}
        <button
          onClick={() => setShowTip(true)}
          className="absolute top-2 right-2 text-slate-500 hover:text-yellow-400 transition-colors text-lg"
          title="Tip de gramática"
        >
          💡
        </button>

        <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">
          {langPair(word.idioma_origen, word.idioma_destino)}
        </p>

        {/* Label indicating this is an article exercise */}
        <p className="text-xs text-blue-400 uppercase tracking-wide mb-3">
          {uiLang === 'de' ? 'Artikel wählen' :
           uiLang === 'en' ? 'Choose article' :
           uiLang === 'fr' ? 'Choisir l\'article' :
           'Elige el artículo'}
        </p>

        {/* Noun without article, large */}
        <p className="font-bold text-4xl mb-2 break-words hyphens-auto leading-tight [word-break:break-word]">
          {noun}
        </p>

        {/* Significado as context */}
        <p className="text-slate-400 text-sm mb-3">{word.significado}</p>

        <SpeakButton
          onClick={speak}
          hasMp3={!!word.audio_url}
          size="lg"
        />

        {word.tema_nombre && (
          <span
            className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium text-white"
            style={{ backgroundColor: word.tema_color ?? '#64748b' }}
          >
            {word.tema_nombre}
          </span>
        )}
      </div>

      {/* Article buttons */}
      <div className="flex gap-3 justify-center">
        {SIMPLE_ARTICLE_OPTIONS.map((article) => (
          <button
            key={article}
            onClick={() => pick(article)}
            className={`px-6 py-3 rounded-xl border-2 font-bold text-lg transition-all duration-200 min-w-[80px] ${choiceClass(article)}`}
          >
            {article}
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
