// What a device must provide for dictation. Capture and recognition stay on the device that owns the microphone; a
// paired host never sees audio. Real adapters (native modules, Electron main) implement these; the session only
// depends on the shapes, so it can be exercised with fakes.

import type { DictationFailure } from './dictation'

/** A failure an adapter reports, kept apart so the person sees the right next step. */
export class VoiceError extends Error {
  constructor(
    readonly reason: DictationFailure,
    message?: string,
  ) {
    super(message ?? reason)
    this.name = 'VoiceError'
  }
}

export type VoiceReadiness =
  /** Capture and recognition can start now. */
  | 'ready'
  /** The device or platform has no local engine. Typing and system keyboard dictation still work. */
  | 'unsupported'
  /** An engine exists but not for the chosen speech language. */
  | 'language-unsupported'
  /** A local language model must be downloaded first (explicit action). */
  | 'model-needed'
  /** Permission has not been asked yet; asked only when the person starts recording or setup. */
  | 'permission-needed'
  /** The OS denied the microphone or speech recognition; only system settings can change that. */
  | 'permission-denied'

export interface VoiceCapability {
  readiness: VoiceReadiness
  /** BCP 47 tags the engine can recognize, installed or downloadable. */
  languages: string[]
  /** What `system` resolved to, when the engine supports it. */
  resolvedLanguage?: string
  /** Download size when a model is needed, for the setup action. */
  modelBytes?: number
  /** Whether recognition is guaranteed to run on this device. Cloud-backed engines must report false and are not used. */
  onDevice: boolean
}

export const UNSUPPORTED_VOICE: VoiceCapability = { readiness: 'unsupported', languages: [], onDevice: false }

/** Audio held by a take. Disposing deletes any temporary file; it must be safe to call more than once. */
export interface VoiceAudio {
  dispose(): Promise<void>
}

export interface VoiceRecording {
  /** Stops capture. The audio is handed to the transcriber, which owns disposing it. */
  stop(): Promise<VoiceAudio>
  /** Stops capture and discards; resolves only when native work has actually settled and resources can be reused. */
  cancel(): Promise<void>
}

export interface VoiceCaptureOptions {
  /** Device the person chose; undefined is the system default. */
  inputDeviceId?: string
  language: string
  maxMs: number
  maxBytes: number
  /** Microphone level 0..1 for the activity indicator. It does not imply recognition progress. */
  onLevel?: (level: number) => void
  /** Called once if the system takes the microphone away (call, route loss, background, lock, permission revoked). */
  onInterrupt: () => void
  /** Called once when the adapter stopped by itself at the time or byte cap; the take then waits for the person. */
  onLimit?: () => void
}

export interface VoiceCapture {
  /** Asks for permission if needed. Never prompts again after a denial. */
  start(options: VoiceCaptureOptions): Promise<VoiceRecording>
}

export interface VoiceTranscriber {
  capability(language: string): Promise<VoiceCapability>
  /** Downloads a missing local model. Cancellation through the signal; progress 0..1. */
  prepare(language: string, options: { signal: AbortSignal; onProgress?: (progress: number) => void }): Promise<void>
  /** Recognizes one take and disposes its audio. A cancelled signal discards the result but still disposes. */
  transcribe(audio: VoiceAudio, language: string, options: { signal: AbortSignal }): Promise<string>
}

export interface VoiceEngine {
  capture: VoiceCapture
  transcriber: VoiceTranscriber
}

/** The engine of a device with nothing local: the microphone control stays hidden and typing is unaffected. */
export const UNAVAILABLE_VOICE_ENGINE: VoiceEngine = {
  capture: {
    start() {
      return Promise.reject(new VoiceError('unavailable'))
    },
  },
  transcriber: {
    capability: () => Promise.resolve(UNSUPPORTED_VOICE),
    prepare: () => Promise.reject(new VoiceError('unavailable')),
    transcribe: () => Promise.reject(new VoiceError('unavailable')),
  },
}

/** One active recording per device. Release only works for the operation that acquired it. */
export interface VoiceLease {
  acquire(operationId: string): boolean
  release(operationId: string): void
  holder(): string | undefined
}

export function createVoiceLease(): VoiceLease {
  let current: string | undefined
  return {
    acquire(id) {
      if (current !== undefined) return false
      current = id
      return true
    },
    release(id) {
      if (current === id) current = undefined
    },
    holder: () => current,
  }
}
