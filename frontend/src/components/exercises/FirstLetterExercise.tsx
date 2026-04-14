/**
 * FirstLetterExercise
 *
 * Shows the source word. Answer slots show each target word with a box for its initial letter.
 * On correct pick: fills the box AND reveals the full word.
 * On error: flash red, reset.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReviewWord } from '../../types'
import { accentInsensitiveMatch } from '../../utils/normalize'
import { langPair } from '../../utils/langFlags'
import SpeakButton from '../SpeakButton'

interface Props {
  word: ReviewWord
  onAnswer: (correct: boolean) => void
  /** ms to wait before calling onAnswer(true). 0 = caller handles timing */
  autoAdvanceMs?: number
  autoPlay?: boolean
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

function getInitials(text: string): string[] {
  return text.trim().split(/\s+/).map((w) => w[0].toLowerCase())
}

function buildLetterPool(initials: string[]): string[] {
  const needed = new Set(initials)
  const extras: string[] = []
  const shuffled = [...ALPHABET].sort(() => Math.random() - 0.5)
  for (const ch of shuffled) {
    if (!needed.has(ch) && extras.length < 4) extras.push(ch)
  }
  return [...initials, ...extras].sort(() => Math.random() - 0.5)
}

export default function FirstLetterExercise({ word, onAnswer, autoAdvanceMs, autoPlay = false }: Props) {
  const { t } = useTranslation()
  const target = word.significado
  const targetWords = useMemo(() => target.trim().split(/\s+/), [target])
  const initials = useMemo(() => getInitials(target), [target])
  const letterPool = useMemo(() => buildLetterPool(initials), [initials])

  const [chosen, setChosen] = useState<string[]>([])
  const [flash, setFlash] = useState<'error' | 'correct' | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

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

  useEffect(() => {
    setChosen([])
    setFlash(null)
    if (!autoPlay) return
    speechSynthesis.cancel()
    audioRef.current?.pause()
    const timer = setTimeout(() => speak(), 150)
    return () => { clearTimeout(timer); speechSynthesis.cancel(); audioRef.current?.pause() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, autoPlay])

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onAnswer(false); return }
      const ch = e.key.toLowerCase()
      if (ch.length !== 1 || !/[a-záéíóúüàèìòùñäëïöüß]/.test(ch)) return
      pick(ch)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.user_word_id, chosen, flash])

  const pick = (letter: string) => {
    if (flash) return
    const nextIndex = chosen.length
    const expected = initials[nextIndex]
    const matched = letter.toLowerCase() === expected ||
      accentInsensitiveMatch(letter, expected)
    if (matched) {
      const next = [...chosen, expected]
      setChosen(next)
      if (next.length === initials.length) {
        setFlash('correct')
        if (autoAdvanceMs !== undefined) {
          setTimeout(() => onAnswer(true), autoAdvanceMs)
        } else {
          // caller controls when to advance (button mode)
          setTimeout(() => onAnswer(true), 300)
        }
      }
    } else {
      setFlash('error')
      setTimeout(() => {
        setFlash(null)
        setChosen([])
      }, 700)
      setTimeout(() => onAnswer(false), 800)
    }
  }

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Source word */}
      <div className="card text-center">
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">
          {langPair(word.idioma_origen, word.idioma_destino)}
        </p>
        <p className="text-4xl font-bold">{word.palabra}</p>
        <SpeakButton
          onClick={speak}
          hasMp3={!!(word.reversed ? word.audio_url_translation : word.audio_url)}
          size="lg"
          className="mt-2"
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

      {/* Word slots */}
      <div className="card text-center space-y-3">
        <p className="text-xs text-slate-500 uppercase tracking-widest">
          {t('settings.exercises.first_letter')}
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          {targetWords.map((w, i) => {
            const filled = chosen[i]
            const isError = flash === 'error' && i === chosen.length
            const isCorrect = flash === 'correct' || (!!filled && i < chosen.length)

            return (
              <div key={i} className="flex flex-col items-center gap-1">
                {/* Initial letter box */}
                <span
                  className={`text-xl font-bold w-10 h-10 flex items-center justify-center rounded-lg border-2 transition-all duration-200 ${
                    isError
                      ? 'border-red-500 text-red-400 bg-red-500/10'
                      : isCorrect
                      ? 'border-green-500 text-green-400 bg-green-500/10'
                      : 'border-slate-500 text-slate-400'
                  }`}
                >
                  {filled ? filled.toUpperCase() : '_'}
                </span>
                {/* Full word — shown when filled */}
                <span
                  className={`text-sm font-medium transition-all duration-300 ${
                    filled
                      ? flash === 'correct'
                        ? 'text-green-400 opacity-100'
                        : 'text-slate-300 opacity-100'
                      : 'text-slate-700 opacity-0 select-none'
                  }`}
                >
                  {w}
                </span>
              </div>
            )
          })}
        </div>

        {flash === 'correct' && (
          <p className="text-green-400 text-sm font-medium animate-slide-up">
            ✓ {target}
          </p>
        )}
      </div>

      {/* Letter buttons */}
      <div className="flex flex-wrap gap-2 justify-center">
        {letterPool.map((letter, i) => (
          <button
            key={i}
            onClick={() => pick(letter)}
            disabled={flash === 'correct'}
            className={`w-12 h-12 rounded-xl border-2 text-lg font-bold uppercase transition-all active:scale-90 ${
              flash === 'correct'
                ? 'border-slate-700 text-slate-600 bg-slate-800'
                : 'border-slate-500 bg-slate-700 text-white hover:border-blue-400 hover:bg-slate-600'
            }`}
          >
            {letter.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Don't know button */}
      <button
        type="button"
        onClick={() => onAnswer(false)}
        className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors pt-1"
      >
        <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-slate-600 text-[9px] font-mono text-slate-500 mr-1">Esc</kbd>
        {t('settings.exercises.dontKnow')}
      </button>
    </div>
  )
}
