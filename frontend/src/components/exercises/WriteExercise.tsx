import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReviewWord } from '../../types'
import SpeakButton from '../SpeakButton'
import { langPair } from '../../utils/langFlags'
import { stripAccent } from '../../utils/normalize'
import { assignShortcuts, ShortcutLabel } from '../../utils/shortcutLabel'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean, userInput: string) => void
  autoPlay?: boolean
}

export default function WriteExercise({ word, onAnswer, autoPlay = false }: Props) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const choices = word.choices ?? null

  // Translated button labels
  const labelDontKnow  = t('settings.exercises.dontKnow')
  const labelCheck     = t('settings.exercises.check')
  const labelShowOpts  = t('settings.exercises.showOptions')
  const labelWriteAns  = t('settings.exercises.writeAnswer')
  const labelMarkWrong = t('settings.exercises.markWrong')
  const labelMarkRight = t('settings.exercises.markRight')

  // Shortcuts for write-mode action buttons (pre-reveal)
  const actionShortcuts = useMemo(
    () => assignShortcuts(choices ? [labelDontKnow, labelShowOpts] : [labelDontKnow]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labelDontKnow, labelShowOpts, !!choices]
  )

  // Shortcuts for mark buttons (post-reveal)
  const markShortcuts = useMemo(
    () => assignShortcuts([labelMarkWrong, labelMarkRight]),
    [labelMarkWrong, labelMarkRight]
  )

  // Shortcuts for options mode — same assignShortcuts used in MultipleChoiceExercise
  const optionShortcuts = useMemo(
    () => choices ? assignShortcuts(choices) : new Map<string, string>(),
    [choices]
  )
  const optionShortcutToChoice = useMemo(() => {
    const m = new Map<string, string>()
    optionShortcuts.forEach((sc, choice) => { if (sc) m.set(sc, choice) })
    return m
  }, [optionShortcuts])

  const speak = () => {
    const url = word.reversed ? word.audio_url_translation : word.audio_url
    if (url) {
      audioRef.current?.pause()
      audioRef.current = new Audio(url)
      audioRef.current.play().catch(() => {})
      return
    }
    speechSynthesis.cancel()
    const text = word.reversed ? word.significado : word.palabra
    const lang = word.reversed ? word.idioma_destino : word.idioma_origen
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    speechSynthesis.speak(u)
  }

  const revealedRef = useRef(revealed)
  const showOptionsRef = useRef(showOptions)
  const selectedChoiceRef = useRef(selectedChoice)
  revealedRef.current = revealed
  showOptionsRef.current = showOptions
  selectedChoiceRef.current = selectedChoice

  // Keep shortcut maps in refs for the keydown handler
  const actionShortcutsRef = useRef(actionShortcuts)
  const optionShortcutToChoiceRef = useRef(optionShortcutToChoice)
  const markShortcutsRef = useRef(markShortcuts)
  const inputRef2 = useRef(input)
  actionShortcutsRef.current = actionShortcuts
  optionShortcutToChoiceRef.current = optionShortcutToChoice
  markShortcutsRef.current = markShortcuts
  inputRef2.current = input

  useEffect(() => {
    setInput('')
    setRevealed(false)
    setIsCorrect(null)
    setShowOptions(false)
    setSelectedChoice(null)
    inputRef.current?.focus()

    if (!autoPlay) return
    speechSynthesis.cancel()
    audioRef.current?.pause()
    const timer = setTimeout(() => speak(), 150)
    return () => { clearTimeout(timer); speechSynthesis.cancel(); audioRef.current?.pause() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, autoPlay])

  // Alt+key shortcuts — work even when input has focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !revealedRef.current && !showOptionsRef.current) {
        setIsCorrect(false)
        setRevealed(true)
        return
      }
      if (e.key.length !== 1) return
      const key = stripAccent(e.key.toLowerCase())

      // Revealed state: plain key or Alt+key for mark buttons (no input active)
      if (revealedRef.current) {
        if (e.altKey) return
        const scWrong = markShortcutsRef.current.get(labelMarkWrong) ?? ''
        const scRight = markShortcutsRef.current.get(labelMarkRight) ?? ''
        if (key === scWrong) onAnswer(false, inputRef2.current.trim())
        else if (key === scRight) onAnswer(true, inputRef2.current.trim())
        return
      }

      if (showOptionsRef.current) {
        // Options mode: plain key picks a choice (no input active)
        if (e.altKey) return
        if (selectedChoiceRef.current) return
        const choice = optionShortcutToChoiceRef.current.get(key)
        if (choice) pickChoice(choice)
        return
      }

      // Write mode: Alt+key triggers action buttons (input may be focused)
      if (!e.altKey) return
      e.preventDefault()
      const scDontKnow = actionShortcutsRef.current.get(labelDontKnow) ?? ''
      const scShowOpts = actionShortcutsRef.current.get(labelShowOpts) ?? ''
      if (key === scDontKnow) {
        setIsCorrect(false)
        setRevealed(true)
      } else if (key === scShowOpts && choices) {
        setShowOptions(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, labelDontKnow, labelShowOpts, labelMarkWrong, labelMarkRight])

  const check = (e: FormEvent) => {
    e.preventDefault()
    const correct = input.trim().toLowerCase() === word.significado.trim().toLowerCase()
    setIsCorrect(correct)
    setRevealed(true)
  }

  const pickChoice = (choice: string) => {
    if (selectedChoice) return
    const correct = choice === word.significado
    setSelectedChoice(choice)
    setIsCorrect(correct)
    setRevealed(true)
    setTimeout(() => onAnswer(correct, choice), 900)
  }

  const choiceClass = (choice: string) => {
    if (!selectedChoice) return 'bg-slate-700 hover:bg-slate-600 border-slate-600 cursor-pointer'
    if (choice === word.significado) return 'bg-green-500/20 border-green-500 text-green-200'
    if (choice === selectedChoice) return 'bg-red-500/20 border-red-500 text-red-200'
    return 'bg-slate-700 border-slate-600 opacity-40'
  }

  const scDontKnow = actionShortcuts.get(labelDontKnow) ?? ''
  const scShowOpts = actionShortcuts.get(labelShowOpts) ?? ''

  return (
    <div className="space-y-5 animate-slide-up">
      <div className="card text-center">
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">
          {langPair(word.idioma_origen, word.idioma_destino)}
        </p>
        <p className="font-bold mb-3 break-words hyphens-auto leading-tight
          text-4xl [word-break:break-word]">{word.palabra}</p>
        <SpeakButton
          onClick={speak}
          hasMp3={!!(word.reversed ? word.audio_url_translation : word.audio_url)}
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

      {/* Options mode */}
      {showOptions && choices ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((choice, i) => (
            <button
              key={i}
              onClick={() => pickChoice(choice)}
              className={`px-4 py-2 rounded-xl border-2 font-medium text-sm transition-all duration-200 ${choiceClass(choice)}`}
            >
              {!selectedChoice
                ? <ShortcutLabel text={choice} shortcut={optionShortcuts.get(choice) ?? ''} />
                : choice}
            </button>
          ))}
          {!revealed && (
            <button
              type="button"
              onClick={() => { setShowOptions(false); setTimeout(() => inputRef.current?.focus(), 50) }}
              className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors pt-1"
            >
              {labelWriteAns}
            </button>
          )}
        </div>
      ) : !revealed ? (
        /* Write mode */
        <form onSubmit={check} className="space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="input text-lg text-center"
            placeholder={`✍ ${langPair(word.idioma_origen, word.idioma_destino)}`}
            autoComplete="off"
            autoCorrect="off"
          />
          <button type="submit" className="btn-primary w-full" disabled={!input.trim()}>
            {labelCheck}
          </button>
          <button
            type="button"
            onClick={() => { setIsCorrect(false); setRevealed(true) }}
            className="btn-secondary w-full text-sm"
          >
            <ShortcutLabel text={labelDontKnow} shortcut={scDontKnow} />
          </button>
          {choices && (
            <button
              type="button"
              onClick={() => setShowOptions(true)}
              className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors pt-1"
            >
              <ShortcutLabel text={labelShowOpts} shortcut={scShowOpts} />
            </button>
          )}
        </form>
      ) : (
        /* Revealed — write mode result */
        <div className="space-y-4 animate-slide-up">
          <div className={`card text-center border-2 ${isCorrect ? 'border-green-500' : 'border-red-500'}`}>
            {!isCorrect && input && (
              <p className="text-red-400 text-sm mb-1">{t('settings.exercises.yourAnswer')}: {input}</p>
            )}
            <p className="text-xl font-semibold">{word.significado}</p>
            <p className={`text-sm font-medium mt-2 ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
              {isCorrect ? t('settings.exercises.correct') : t('settings.exercises.incorrect')}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => onAnswer(false, input.trim())}
              className="flex-1 btn-secondary border border-red-500/50 text-red-300"
            >
              <ShortcutLabel text={labelMarkWrong} shortcut={markShortcuts.get(labelMarkWrong) ?? ''} />
            </button>
            <button
              onClick={() => onAnswer(true, input.trim())}
              className="flex-1 btn-primary bg-green-600 hover:bg-green-700"
            >
              <ShortcutLabel text={labelMarkRight} shortcut={markShortcuts.get(labelMarkRight) ?? ''} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
