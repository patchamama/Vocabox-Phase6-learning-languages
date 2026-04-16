import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ReviewMode = 'simple' | 'safe'
export type TransitionType = 'auto' | 'button'
export type RoundType = 'pair_match' | 'first_letter' | 'anagram' | 'write' | 'multiple_choice' | 'random'
export type ReviewDirection = 'forward' | 'reverse' | 'both'

// Default Leitner spacing: box 0 = same day, box 1 = 1d, box 2 = 2d, box 3 = 4d, box 4 = 7d, box 5 = 14d, box 6 = 30d
export const DEFAULT_LEITNER_DAYS: [number, number, number, number, number, number, number] = [0, 1, 2, 4, 7, 14, 30]

interface SettingsState {
  reviewMode: ReviewMode
  wordsPerSession: number
  transitionDelay: number
  transitionType: TransitionType

  /** Exercise type to use in each of the 3 safe-mode rounds (for non-phrase words) */
  safeRound1: RoundType
  safeRound2: RoundType
  safeRound3: RoundType
  /** Auto-play word pronunciation when an exercise loads */
  autoPlayAudio: boolean
  /** Also auto-play when the exercise is reversed (meaning → word). Default false. */
  autoPlayAudioReversed: boolean
  /** Filter out phrases (>2 words) across the whole app */
  wordsOnly: boolean
  /** Days to wait per box level before word is due again (Leitner spacing) */
  leitnerDays: [number, number, number, number, number, number, number]
  /** Words per page options in the Words list [slot1, slot2, slot3] */
  pageSizeOptions: [number, number, number]
  /** Currently selected page size in the Words list */
  selectedPageSize: number
  /** Direction of review: forward (word→meaning), reverse (meaning→word), both (random) */
  reviewDirection: ReviewDirection
  /** Use TTS to fill missing audio clips in audio review generation */
  useTtsInAudioReview: boolean
  /** TTS voice selection per language code, e.g. { de: 'Anna', es: 'Monica' } */
  ttsVoices: Record<string, string>
  /** TTS speech rate multiplier: 0.5 = slow, 1.0 = normal, 1.5 = fast */
  ttsRate: number
  /** Auto-fetch extra language translations from LEO when applying a LEO result */
  leoAutoFetchExtras: boolean
  /** Extra language codes to fetch automatically from LEO (e.g. ['en', 'fr']) */
  leoExtraLangs: string[]
  /** Include extra-language segments in audio review generation */
  audioReviewExtraLangs: boolean
  /** Ollama model to use for auto-translating missing entries (empty = disabled) */
  ollamaTranslationModel: string
  /** Timeout in seconds for Ollama requests (10–300) */
  ollamaTimeout: number
  /** Custom prompt template for Ollama translation (empty = use default) */
  ollamaPromptTranslate: string
  /** Custom prompt template for Ollama word enhancement (empty = use default) */
  ollamaPromptEnhance: string
  /** Complete existing MP3 with TTS for text not covered by the original recording */
  completeWithTts: boolean
  /** Seconds to wait between video clips in VideoRefsModal (0 = no wait) */
  videoClipPauseSec: number
  /** Context subtitle lines to show before and after the current clip segment */
  videoClipContext: number
  /** Auto-play all clips sequentially and cycle back to start */
  videoClipAutoPlay: boolean
  /** YouTube playback rate (0.5 | 0.75 | 1 | 1.25 | 1.5 | 1.75 | 2) */
  videoClipPlaybackRate: number
  /** Maximum number of video clips to store per word (1–50) */
  maxRefsPerWord: number
  /** Which word fields to use when indexing subtitle clips */
  subtitleIndexPalabra: boolean
  subtitleIndexAudioText: boolean
  subtitleIndexSignificado: boolean

  setReviewMode: (mode: ReviewMode) => void
  setWordsPerSession: (n: number) => void
  setTransitionDelay: (s: number) => void
  setTransitionType: (t: TransitionType) => void
  setSafeRound: (round: 1 | 2 | 3, type: RoundType) => void
  setAutoPlayAudio: (v: boolean) => void
  setAutoPlayAudioReversed: (v: boolean) => void
  setWordsOnly: (v: boolean) => void
  setLeitnerDay: (box: number, days: number) => void
  setPageSizeOption: (slot: 0 | 1 | 2, value: number) => void
  setSelectedPageSize: (n: number) => void
  setReviewDirection: (d: ReviewDirection) => void
  setUseTtsInAudioReview: (v: boolean) => void
  setTtsVoice: (lang: string, voice: string) => void
  setTtsRate: (rate: number) => void
  setLeoAutoFetchExtras: (v: boolean) => void
  setLeoExtraLangs: (langs: string[]) => void
  setAudioReviewExtraLangs: (v: boolean) => void
  setOllamaTranslationModel: (model: string) => void
  setOllamaTimeout: (n: number) => void
  setOllamaPromptTranslate: (p: string) => void
  setOllamaPromptEnhance: (p: string) => void
  setCompleteWithTts: (v: boolean) => void
  setVideoClipPauseSec: (n: number) => void
  setVideoClipContext: (n: number) => void
  setVideoClipAutoPlay: (v: boolean) => void
  setVideoClipPlaybackRate: (r: number) => void
  setMaxRefsPerWord: (n: number) => void
  setSubtitleIndexPalabra: (v: boolean) => void
  setSubtitleIndexAudioText: (v: boolean) => void
  setSubtitleIndexSignificado: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      reviewMode: 'simple',
      wordsPerSession: 20,
      transitionDelay: 3,
      transitionType: 'auto',
      safeRound1: 'pair_match',
      safeRound2: 'first_letter',
      safeRound3: 'random',
      autoPlayAudio: false,
      autoPlayAudioReversed: false,
      wordsOnly: false,
      leitnerDays: DEFAULT_LEITNER_DAYS,
      pageSizeOptions: [10, 30, 50],
      selectedPageSize: 30,
      reviewDirection: 'forward',
      useTtsInAudioReview: false,
      ttsVoices: {},
      ttsRate: 0.9,
      leoAutoFetchExtras: false,
      leoExtraLangs: [],
      audioReviewExtraLangs: true,
      ollamaTranslationModel: '',
      ollamaTimeout: 60,
      ollamaPromptTranslate: '',
      ollamaPromptEnhance: '',
      completeWithTts: true,
      videoClipPauseSec: 1,
      videoClipContext: 1,
      videoClipAutoPlay: true,
      videoClipPlaybackRate: 1,
      maxRefsPerWord: 10,
      subtitleIndexPalabra: true,
      subtitleIndexAudioText: true,
      subtitleIndexSignificado: true,

      setReviewMode: (reviewMode) => set({ reviewMode }),
      setWordsPerSession: (wordsPerSession) => set({ wordsPerSession }),
      setTransitionDelay: (transitionDelay) => set({ transitionDelay }),
      setTransitionType: (transitionType) => set({ transitionType }),
      setSafeRound: (round, type) => set({ [`safeRound${round}`]: type } as Pick<SettingsState, 'safeRound1' | 'safeRound2' | 'safeRound3'>),
      setAutoPlayAudio: (autoPlayAudio) => set({ autoPlayAudio }),
      setAutoPlayAudioReversed: (autoPlayAudioReversed) => set({ autoPlayAudioReversed }),
      setWordsOnly: (wordsOnly) => set({ wordsOnly }),
      setLeitnerDay: (box, days) =>
        set((state) => {
          const next = [...state.leitnerDays] as [number, number, number, number, number, number, number]
          next[box] = days
          return { leitnerDays: next }
        }),
      setPageSizeOption: (slot, value) =>
        set((state) => {
          const next = [...state.pageSizeOptions] as [number, number, number]
          next[slot] = value
          return { pageSizeOptions: next }
        }),
      setSelectedPageSize: (selectedPageSize) => set({ selectedPageSize }),
      setReviewDirection: (reviewDirection) => set({ reviewDirection }),
      setUseTtsInAudioReview: (useTtsInAudioReview) => set({ useTtsInAudioReview }),
      setTtsVoice: (lang, voice) =>
        set((state) => ({ ttsVoices: { ...state.ttsVoices, [lang]: voice } })),
      setTtsRate: (ttsRate) => set({ ttsRate }),
      setLeoAutoFetchExtras: (leoAutoFetchExtras) => set({ leoAutoFetchExtras }),
      setLeoExtraLangs: (leoExtraLangs) => set({ leoExtraLangs }),
      setAudioReviewExtraLangs: (audioReviewExtraLangs) => set({ audioReviewExtraLangs }),
      setOllamaTranslationModel: (ollamaTranslationModel) => set({ ollamaTranslationModel }),
      setOllamaTimeout: (ollamaTimeout) => set({ ollamaTimeout: Math.max(10, Math.min(300, ollamaTimeout)) }),
      setOllamaPromptTranslate: (ollamaPromptTranslate) => set({ ollamaPromptTranslate }),
      setOllamaPromptEnhance: (ollamaPromptEnhance) => set({ ollamaPromptEnhance }),
      setCompleteWithTts: (completeWithTts) => set({ completeWithTts }),
      setVideoClipPauseSec: (videoClipPauseSec) => set({ videoClipPauseSec: Math.max(0, Math.min(10, videoClipPauseSec)) }),
      setVideoClipContext: (videoClipContext) => set({ videoClipContext: Math.max(0, Math.min(5, videoClipContext)) }),
      setVideoClipAutoPlay: (videoClipAutoPlay) => set({ videoClipAutoPlay }),
      setVideoClipPlaybackRate: (videoClipPlaybackRate) => set({ videoClipPlaybackRate }),
      setMaxRefsPerWord: (maxRefsPerWord) => set({ maxRefsPerWord: Math.max(1, Math.min(50, maxRefsPerWord)) }),
      setSubtitleIndexPalabra: (subtitleIndexPalabra) => set({ subtitleIndexPalabra }),
      setSubtitleIndexAudioText: (subtitleIndexAudioText) => set({ subtitleIndexAudioText }),
      setSubtitleIndexSignificado: (subtitleIndexSignificado) => set({ subtitleIndexSignificado }),
    }),
    { name: 'vocabox-settings' }
  )
)
