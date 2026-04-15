/**
 * audioManager — singleton that ensures only one audio source plays at a time.
 * Works for both HTMLAudioElement and SpeechSynthesis.
 */

let currentAudio: HTMLAudioElement | null = null

/** Stop whatever is currently playing (audio element or speech synthesis). */
export function stopCurrent() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel()
  }
}

/**
 * Play an HTMLAudioElement, stopping any previous audio first.
 * Returns the audio element so the caller can attach event listeners.
 */
export function playAudio(audio: HTMLAudioElement): HTMLAudioElement {
  stopCurrent()
  currentAudio = audio
  audio.onended = () => {
    if (currentAudio === audio) currentAudio = null
  }
  audio.play().catch(() => {})
  return audio
}

/**
 * Speak via SpeechSynthesis, stopping any previous audio first.
 */
export function speakUtterance(utterance: SpeechSynthesisUtterance) {
  stopCurrent()
  speechSynthesis.speak(utterance)
}
