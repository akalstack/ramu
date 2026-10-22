// Device-local voice input choices and what the microphone control shows for an engine's readiness. These belong to
// the device that owns the microphone: never host preferences, never sent to a paired host.

import type { VoiceCapability, VoiceReadiness } from './engine'

export const SYSTEM_LANGUAGE = 'system'

export interface VoiceSettings {
  /** Show the microphone control at all. Typing and system keyboard dictation are unaffected either way. */
  enabled: boolean
  /** `system` follows the device language; otherwise a BCP 47 tag chosen from what the engine supports. */
  language: string
  /** Desktop microphone; undefined is the system default. */
  inputDeviceId?: string
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { enabled: true, language: SYSTEM_LANGUAGE }

const TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/

/** Reads stored settings, dropping anything malformed so a bad value falls back to the default. */
export function parseVoiceSettings(raw: unknown): VoiceSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_VOICE_SETTINGS
  const value = raw as Record<string, unknown>
  const language =
    typeof value.language === 'string' && (value.language === SYSTEM_LANGUAGE || TAG.test(value.language))
      ? value.language
      : SYSTEM_LANGUAGE
  const inputDeviceId =
    typeof value.inputDeviceId === 'string' && value.inputDeviceId.length > 0 && value.inputDeviceId.length <= 512
      ? value.inputDeviceId
      : undefined
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    language,
    ...(inputDeviceId ? { inputDeviceId } : {}),
  }
}

/** Picks the engine language for a setting: exact tag, then the same base language. Never silently falls back to English. */
export function resolveSpeechLanguage(setting: string, systemLocale: string, supported: string[]): string | undefined {
  const wanted = (setting === SYSTEM_LANGUAGE ? systemLocale : setting).toLowerCase()
  if (!wanted) return undefined
  const exact = supported.find((tag) => tag.toLowerCase() === wanted)
  if (exact) return exact
  const base = wanted.split('-')[0]
  return supported.find((tag) => tag.toLowerCase().split('-')[0] === base)
}

export type MicControl =
  /** Nothing offered: the setting is off, or this device has no local engine. */
  | { kind: 'hidden' }
  /** Starts recording. */
  | { kind: 'record' }
  /** A setup step comes first; no permission is asked before the person starts it. */
  | { kind: 'setup'; reason: Extract<VoiceReadiness, 'model-needed' | 'permission-needed'>; modelBytes?: number }
  /** Shown disabled with an explanation and, for permission, a way to system settings. */
  | { kind: 'blocked'; reason: Extract<VoiceReadiness, 'permission-denied' | 'language-unsupported'> }

export function micControl(settings: VoiceSettings, capability: VoiceCapability | undefined): MicControl {
  if (!settings.enabled || !capability || !capability.onDevice) return { kind: 'hidden' }
  switch (capability.readiness) {
    case 'ready':
      return { kind: 'record' }
    case 'model-needed':
      return { kind: 'setup', reason: 'model-needed', modelBytes: capability.modelBytes }
    case 'permission-needed':
      return { kind: 'setup', reason: 'permission-needed' }
    case 'permission-denied':
      return { kind: 'blocked', reason: 'permission-denied' }
    case 'language-unsupported':
      return { kind: 'blocked', reason: 'language-unsupported' }
    case 'unsupported':
      return { kind: 'hidden' }
  }
}

/** Elapsed recording time as m:ss. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
