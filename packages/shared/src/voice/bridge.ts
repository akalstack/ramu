// The desktop shell's narrow dictation bridge. Electron main owns the microphone permission, the single recording
// lease across windows, temporary audio files and the local recognizer; the renderer only captures audio after a
// person's action and hands it over with the token main issued. Guest pages, Interactive Content, provider tools and
// remote hosts never get this bridge. Audio never reaches a host.

import type { DictationFailure } from './dictation'
import type { VoiceCapability } from './engine'

export interface VoiceBridge {
  capability(language: string): Promise<VoiceCapability>
  /** Checks the microphone permission (asking only while undecided) and takes the one recording lease. */
  begin(language: string): Promise<{ token: string }>
  /** Recognizes one take of 16 kHz, 16-bit mono PCM. Always releases the lease and deletes the temporary audio. */
  transcribe(token: string, pcm: ArrayBuffer, language: string): Promise<string>
  /** Releases the lease for a take that was cancelled or failed before it could be transcribed. */
  cancel(token: string): Promise<void>
  /** Opens the system's privacy settings for the microphone or speech recognition. */
  openSettings(): Promise<void>
}

/** Main reports a failure as an Error whose message is `voice:<reason>`. */
export const VOICE_ERROR_PREFIX = 'voice:'

const REASONS: DictationFailure[] = [
  'permission',
  'unavailable',
  'language',
  'model',
  'capture',
  'recognition',
  'empty',
  'interrupted',
]

export const voiceErrorMessage = (reason: DictationFailure): string => `${VOICE_ERROR_PREFIX}${reason}`

/** Reads the reason out of an error that crossed the IPC boundary; anything else counts as a recognition failure. */
export function voiceErrorReason(error: unknown): DictationFailure {
  const message = error instanceof Error ? error.message : String(error)
  const match = /voice:([a-z]+)/.exec(message)
  return REASONS.find((reason) => reason === match?.[1]) ?? 'recognition'
}

/** 16 kHz mono PCM16 wrapped as a WAV file, the form the macOS recognizer helper reads. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 16_000): Uint8Array {
  const wav = new Uint8Array(44 + pcm.length)
  const view = new DataView(wav.buffer)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, pcm.length, true)
  wav.set(pcm, 44)
  return wav
}
