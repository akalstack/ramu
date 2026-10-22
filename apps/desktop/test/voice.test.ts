import { afterEach, beforeEach, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopVoice, type MicrophoneAccess, type SpeechHelper } from '../src/main/voice'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-voice-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const granted: MicrophoneAccess = { status: () => 'granted', ask: () => Promise.resolve(true) }
const pcm = new Uint8Array(3200)

function helperFor(replies: Record<string, string>, seen: string[][] = []): SpeechHelper {
  return async (args) => {
    seen.push(args)
    return replies[args[0]!] ?? '{}'
  }
}

const ready = JSON.stringify({ readiness: 'ready', languages: ['en-US', 'id-ID'], resolvedLanguage: 'en-US' })

it('is unsupported off macOS so typing and system dictation stay the only options', async () => {
  const voice = new DesktopVoice({ dir, platform: 'linux', microphone: granted, helper: helperFor({}) })
  expect((await voice.capability('system')).readiness).toBe('unsupported')
  await expect(voice.begin(1, 'system')).rejects.toThrow('voice:unavailable')
})

it('reports a denied microphone even when the recognizer is ready, and asks only while undecided', async () => {
  const asked: string[] = []
  const denied: MicrophoneAccess = { status: () => 'denied', ask: async () => (asked.push('ask'), false) }
  const voice = new DesktopVoice({ dir, platform: 'darwin', microphone: denied, helper: helperFor({ capability: ready }) })
  expect((await voice.capability('system')).readiness).toBe('permission-denied')
  await expect(voice.begin(1, 'system')).rejects.toThrow('voice:permission')
  expect(asked).toEqual([])
  const undecided: MicrophoneAccess = { status: () => 'not-determined', ask: async () => (asked.push('ask'), true) }
  const fresh = new DesktopVoice({ dir, platform: 'darwin', microphone: undecided, helper: helperFor({ capability: ready }) })
  expect((await fresh.capability('system')).readiness).toBe('permission-needed')
})

it('hands the microphone to one window at a time and frees it when the take ends', async () => {
  const voice = new DesktopVoice({ dir, platform: 'darwin', microphone: granted, helper: helperFor({ capability: ready, transcribe: '{"text":"hello"}' }) })
  const first = await voice.begin(1, 'system')
  expect(voice.holds(1)).toBe(true)
  expect(voice.holds(2)).toBe(false)
  await expect(voice.begin(2, 'system')).rejects.toThrow('voice:capture')
  // Another window cannot transcribe or cancel the first window's take.
  await expect(voice.transcribe(2, first.token, pcm, 'system')).rejects.toThrow('voice:capture')
  voice.cancel(2, first.token)
  expect(voice.holds(1)).toBe(true)
  expect(await voice.transcribe(1, first.token, pcm, 'system')).toBe('hello')
  expect(voice.holds(1)).toBe(false)
  await expect(voice.begin(2, 'system')).resolves.toBeTruthy()
})

it('deletes the temporary audio after transcription, failure and cancellation', async () => {
  const seen: string[][] = []
  let reply = '{"text":"ok"}'
  const helper: SpeechHelper = async (args) => {
    seen.push(args)
    if (args[0] === 'transcribe') {
      expect(existsSync(args[1]!)).toBe(true)
      return reply
    }
    return ready
  }
  const voice = new DesktopVoice({ dir, platform: 'darwin', microphone: granted, helper })
  let take = await voice.begin(1, 'id-ID')
  await voice.transcribe(1, take.token, pcm, 'id-ID')
  expect(readdirSync(dir)).toEqual([])
  expect(seen.find((args) => args[0] === 'transcribe')![2]).toBe('id-ID')
  reply = '{"error":"language"}'
  take = await voice.begin(1, 'system')
  await expect(voice.transcribe(1, take.token, pcm, 'system')).rejects.toThrow('voice:language')
  expect(readdirSync(dir)).toEqual([])
  take = await voice.begin(1, 'system')
  voice.cancel(1, take.token)
  expect(voice.holds(1)).toBe(false)
})

it('rejects empty or oversized audio and a closed window releases its recording', async () => {
  const voice = new DesktopVoice({ dir, platform: 'darwin', microphone: granted, helper: helperFor({ capability: ready }) })
  const take = await voice.begin(1, 'system')
  await expect(voice.transcribe(1, take.token, new Uint8Array(0), 'system')).rejects.toThrow('voice:empty')
  expect(voice.holds(1)).toBe(false)
  await voice.begin(1, 'system')
  voice.release(1)
  expect(voice.holds(1)).toBe(false)
})

it('removes orphaned takes from the owned directory only', () => {
  writeFileSync(join(dir, 'take-abc.wav'), 'x')
  writeFileSync(join(dir, 'keep.txt'), 'x')
  new DesktopVoice({ dir, platform: 'darwin', microphone: granted, helper: helperFor({}) }).cleanupOrphans()
  expect(readdirSync(dir)).toEqual(['keep.txt'])
})
