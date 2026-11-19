import { describe, expect, it } from 'vitest'
import {
  DICTATION_MAX_MS,
  IDLE,
  VOICE_WAVE_BARS,
  VOICE_WAVE_SILENT,
  dictationBusy,
  insertTranscript,
  nextVoiceWave,
  reduceDictation,
  type DictationState,
  type DictationTarget,
} from '../src/voice/dictation'

const target: DictationTarget = { draftKey: 'host-a:thread-1', revision: 4, selection: { start: 5, end: 5 } }
const recording = (): DictationState => reduceDictation(IDLE, { type: 'start', target, now: 1000 })

describe('dictation state', () => {
  it('records, stops into transcribing, and returns to idle when done', () => {
    const state = recording()
    expect(state).toMatchObject({ phase: 'recording', startedAt: 1000 })
    const transcribing = reduceDictation(state, { type: 'stop' })
    expect(transcribing.phase).toBe('transcribing')
    expect(dictationBusy(transcribing)).toBe(true)
    expect(reduceDictation(transcribing, { type: 'done' })).toEqual(IDLE)
  })

  it('does not replace a running take, and cancel discards it', () => {
    const first = recording()
    const other = { ...target, draftKey: 'host-b:thread-9' }
    expect(reduceDictation(first, { type: 'start', target: other, now: 2000 })).toBe(first)
    expect(reduceDictation(first, { type: 'cancel' })).toEqual(IDLE)
  })

  it('stops at the cap and waits for an explicit Transcribe or Discard', () => {
    const early = reduceDictation(recording(), { type: 'tick', now: 1000 + DICTATION_MAX_MS - 1 })
    expect(early.phase).toBe('recording')
    const capped = reduceDictation(recording(), { type: 'tick', now: 1000 + DICTATION_MAX_MS })
    expect(capped.phase).toBe('limit')
    expect(reduceDictation(capped, { type: 'stop' }).phase).toBe('transcribing')
    expect(reduceDictation(capped, { type: 'cancel' })).toEqual(IDLE)
  })

  it('a scope change discards quietly, a system interruption says why, and idle is unaffected', () => {
    expect(reduceDictation(recording(), { type: 'interrupt', reason: 'scope' })).toEqual(IDLE)
    expect(reduceDictation(recording(), { type: 'interrupt', reason: 'system' })).toEqual({
      phase: 'failed',
      reason: 'interrupted',
    })
    expect(reduceDictation(IDLE, { type: 'interrupt', reason: 'system' })).toBe(IDLE)
    const transcribing = reduceDictation(recording(), { type: 'stop' })
    expect(reduceDictation(transcribing, { type: 'interrupt', reason: 'scope' })).toEqual(IDLE)
  })

  it('records a failure, clears it on cancel, and a late done never revives an idle take', () => {
    const failed = reduceDictation(recording(), { type: 'failed', reason: 'permission' })
    expect(failed).toEqual({ phase: 'failed', reason: 'permission' })
    expect(dictationBusy(failed)).toBe(false)
    expect(reduceDictation(failed, { type: 'cancel' })).toEqual(IDLE)
    expect(reduceDictation(IDLE, { type: 'done' })).toEqual(IDLE)
    expect(reduceDictation(IDLE, { type: 'stop' })).toEqual(IDLE)
  })
})

describe('inserting a transcript', () => {
  const draft = (text: string, patch = {}) => ({ draftKey: target.draftKey, revision: 4, text, ...patch })
  it('inserts at the original selection, keeping words apart and the caret after the text', () => {
    const at = { ...target, selection: { start: 4, end: 4 } }
    expect(insertTranscript(draft('Fix tests'), at, ' add  retries ')).toEqual({
      kind: 'inserted',
      text: 'Fix add retries tests',
      caret: 'Fix add retries'.length,
    })
    const mid = { ...target, selection: { start: 5, end: 5 } }
    expect(insertTranscript(draft('Fix tests'), mid, 'x')).toMatchObject({ text: 'Fix t x ests' })
  })
  it('replaces a selected range and does not double spaces or pad a line start', () => {
    const selected = { ...target, selection: { start: 4, end: 9 } }
    const out = insertTranscript(draft('Fix OLD-X now'), selected, 'the login')
    expect(out).toMatchObject({ kind: 'inserted', text: 'Fix the login now' })
    const atStart = { ...target, selection: { start: 0, end: 0 } }
    expect(insertTranscript(draft(''), atStart, 'hello')).toMatchObject({ text: 'hello', caret: 5 })
  })
  it('refuses another draft or an edited one, and ignores silence', () => {
    expect(insertTranscript(draft('x', { draftKey: 'host-b:t' }), target, 'hi')).toEqual({
      kind: 'conflict',
      reason: 'draft',
    })
    expect(insertTranscript(draft('x', { revision: 5 }), target, 'hi')).toEqual({ kind: 'conflict', reason: 'edited' })
    expect(insertTranscript(draft('x'), target, '  \n ')).toEqual({ kind: 'empty' })
  })
  it('clamps a selection that no longer fits the text instead of throwing', () => {
    const far = { ...target, selection: { start: 99, end: 120 } }
    expect(insertTranscript(draft('short'), far, 'more')).toMatchObject({ kind: 'inserted', text: 'short more' })
  })
})

describe('recording meter', () => {
  it('keeps a fixed width and rolls the newest level in at the end', () => {
    const wave = nextVoiceWave(nextVoiceWave(VOICE_WAVE_SILENT, 1), 0.25)
    expect(wave).toHaveLength(VOICE_WAVE_BARS)
    expect(wave.slice(-2)).toEqual([1, 0.5])
  })

  it('clamps levels outside 0..1', () => {
    expect(nextVoiceWave(VOICE_WAVE_SILENT, 4).at(-1)).toBe(1)
    expect(nextVoiceWave(VOICE_WAVE_SILENT, -1).at(-1)).toBe(0)
  })
})
