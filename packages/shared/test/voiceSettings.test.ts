import type { VoiceReadiness } from '../src/voice/engine'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE_SETTINGS,
  formatElapsed,
  micControl,
  parseVoiceSettings,
  resolveSpeechLanguage,
} from '../src/voice/settings'

const cap = (readiness: VoiceReadiness) => ({
  readiness,
  languages: ['en-US', 'id-ID'],
  onDevice: true,
})

describe('voice settings', () => {
  it('falls back to defaults for malformed storage', () => {
    expect(parseVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS)
    expect(parseVoiceSettings({ enabled: 'no', language: '<script>', inputDeviceId: 5 })).toEqual(
      DEFAULT_VOICE_SETTINGS,
    )
    expect(parseVoiceSettings({ enabled: false, language: 'id-ID', inputDeviceId: 'mic-1' })).toEqual({
      enabled: false,
      language: 'id-ID',
      inputDeviceId: 'mic-1',
    })
  })
  it('resolves the system language against supported tags without forcing English', () => {
    expect(resolveSpeechLanguage('system', 'id-ID', ['en-US', 'id-ID'])).toBe('id-ID')
    expect(resolveSpeechLanguage('system', 'id', ['en-US', 'id-ID'])).toBe('id-ID')
    expect(resolveSpeechLanguage('system', 'fr-FR', ['en-US', 'id-ID'])).toBeUndefined()
    expect(resolveSpeechLanguage('en-GB', 'id-ID', ['en-US'])).toBe('en-US')
  })
})

describe('microphone control', () => {
  it('is hidden when off, unsupported or not on-device, and never blocks typing', () => {
    expect(micControl({ ...DEFAULT_VOICE_SETTINGS, enabled: false }, cap('ready'))).toEqual({ kind: 'hidden' })
    expect(micControl(DEFAULT_VOICE_SETTINGS, cap('unsupported'))).toEqual({ kind: 'hidden' })
    expect(micControl(DEFAULT_VOICE_SETTINGS, { ...cap('ready'), onDevice: false })).toEqual({ kind: 'hidden' })
    expect(micControl(DEFAULT_VOICE_SETTINGS, undefined)).toEqual({ kind: 'hidden' })
  })
  it('offers setup before permission and explains a denial', () => {
    expect(micControl(DEFAULT_VOICE_SETTINGS, cap('ready'))).toEqual({ kind: 'record' })
    expect(micControl(DEFAULT_VOICE_SETTINGS, { ...cap('model-needed'), modelBytes: 5 })).toEqual({
      kind: 'setup',
      reason: 'model-needed',
      modelBytes: 5,
    })
    expect(micControl(DEFAULT_VOICE_SETTINGS, cap('permission-needed'))).toMatchObject({ kind: 'setup' })
    expect(micControl(DEFAULT_VOICE_SETTINGS, cap('permission-denied'))).toEqual({
      kind: 'blocked',
      reason: 'permission-denied',
    })
  })
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_900)).toBe('1:05')
  })
})
