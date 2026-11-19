import { expect, it } from 'vitest'
import { pcmToWav, voiceErrorMessage, voiceErrorReason } from '../src/voice/bridge'

it('reads the typed reason out of an error that crossed IPC and defaults to recognition', () => {
  expect(voiceErrorReason(new Error(voiceErrorMessage('permission')))).toBe('permission')
  expect(voiceErrorReason(new Error("Error invoking remote method 'x': Error: voice:language"))).toBe('language')
  expect(voiceErrorReason(new Error('boom'))).toBe('recognition')
  expect(voiceErrorReason('voice:nonsense')).toBe('recognition')
})

it('wraps 16 kHz mono PCM in a valid WAV header', () => {
  const wav = pcmToWav(new Uint8Array([1, 0, 2, 0]))
  const view = new DataView(wav.buffer)
  expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
  expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
  expect(view.getUint32(24, true)).toBe(16_000)
  expect(view.getUint16(22, true)).toBe(1)
  expect(view.getUint32(40, true)).toBe(4)
  expect(wav.length).toBe(48)
  expect(view.getUint32(4, true)).toBe(40)
})
