import { expect, it, vi } from 'vitest'
import { UNAVAILABLE_VOICE_ENGINE, VoiceError, type VoiceAudio } from '@ramu/shared/voice/engine'
import type { VoiceBridge } from '@ramu/shared/voice/bridge'
import { createDesktopVoiceEngine, rmsLevel, toPcm16, voiceFailure } from '../src/voice/desktopEngine'

it('is unavailable without the shell bridge, leaving typing alone', () => {
  expect(createDesktopVoiceEngine(undefined)).toBe(UNAVAILABLE_VOICE_ENGINE)
})

it('converts float samples to clamped little-endian 16-bit PCM', () => {
  const pcm = toPcm16(new Float32Array([0, 1, -1, 2, -2]))
  const view = new DataView(pcm.buffer)
  expect([0, 1, 2, 3, 4].map((index) => view.getInt16(index * 2, true))).toEqual([0, 32767, -32768, 32767, -32768])
})

it('reports microphone level from 0 to 1', () => {
  expect(rmsLevel(new Float32Array())).toBe(0)
  expect(rmsLevel(new Float32Array(100).fill(0.01))).toBeCloseTo(0.08, 2)
  expect(rmsLevel(new Float32Array(100).fill(1))).toBe(1)
})

it('maps bridge errors to typed failures', () => {
  expect(voiceFailure(new Error('voice:permission')).reason).toBe('permission')
  expect(voiceFailure(new VoiceError('language')).reason).toBe('language')
  expect(voiceFailure(new Error('anything else')).reason).toBe('recognition')
})

it('refuses to start when the shell denies the microphone and releases nothing it did not take', async () => {
  const bridge: VoiceBridge = {
    capability: vi.fn(),
    begin: vi.fn().mockRejectedValue(new Error('voice:permission')),
    transcribe: vi.fn(),
    cancel: vi.fn(),
    openSettings: vi.fn(),
  }
  const engine = createDesktopVoiceEngine(bridge)
  await expect(
    engine.capture.start({ language: 'system', maxMs: 1000, maxBytes: 1000, onInterrupt: () => {} }),
  ).rejects.toMatchObject({ reason: 'permission' })
  expect(bridge.cancel).not.toHaveBeenCalled()
})

it('discards a transcript when the take was cancelled while recognition ran', async () => {
  const bridge: VoiceBridge = {
    capability: vi.fn(),
    begin: vi.fn(),
    transcribe: vi.fn().mockResolvedValue('hello'),
    cancel: vi.fn().mockResolvedValue(undefined),
    openSettings: vi.fn(),
  }
  const engine = createDesktopVoiceEngine(bridge)
  const audio = { pcm: new Uint8Array(4), token: 't', dispose: async () => {} } as VoiceAudio
  const controller = new AbortController()
  const pending = engine.transcriber.transcribe(audio, 'system', { signal: controller.signal })
  controller.abort()
  expect(await pending).toBe('')
})
