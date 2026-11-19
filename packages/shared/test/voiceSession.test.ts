import { afterEach, describe, expect, it, vi } from 'vitest'
import { DICTATION_MAX_MS, type DictationTarget } from '../src/voice/dictation'
import {
  UNAVAILABLE_VOICE_ENGINE,
  VoiceError,
  createVoiceLease,
  type VoiceAudio,
  type VoiceCaptureOptions,
  type VoiceEngine,
} from '../src/voice/engine'
import { createVoiceSession, type VoiceDraft } from '../src/voice/session'

const target: DictationTarget = { draftKey: 'host:thread', revision: 1, selection: { start: 0, end: 0 } }

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeEngine(
  overrides: {
    transcript?: Promise<string> | (() => Promise<string>)
    startGate?: Promise<void>
    startError?: Error
  } = {},
) {
  const log: string[] = []
  const nativeCancel = deferred()
  let captureOptions!: VoiceCaptureOptions
  const audio: VoiceAudio = { dispose: () => (log.push('dispose'), Promise.resolve()) }
  const engine: VoiceEngine = {
    capture: {
      async start(options) {
        captureOptions = options
        log.push('start')
        await overrides.startGate
        if (overrides.startError) throw overrides.startError
        return {
          stop: () => (log.push('stop'), Promise.resolve(audio)),
          cancel: () => (log.push('cancel'), nativeCancel.promise),
        }
      },
    },
    transcriber: {
      capability: () => Promise.resolve({ readiness: 'ready', languages: [], onDevice: true }),
      prepare: () => Promise.resolve(),
      transcribe: (_audio, _language, { signal }) => {
        log.push('transcribe')
        signal.addEventListener('abort', () => log.push('aborted'))
        const t = overrides.transcript
        return typeof t === 'function' ? t() : (t ?? Promise.resolve('add retries'))
      },
    },
  }
  return { engine, log, nativeCancel, options: () => captureOptions }
}

function setup(
  engine: VoiceEngine,
  draft: () => VoiceDraft = () => ({ draftKey: target.draftKey, revision: 1, text: 'Fix' }),
) {
  const lease = createVoiceLease()
  const inserted: { text: string; caret: number }[] = []
  let ids = 0
  const session = createVoiceSession({
    engine,
    lease,
    getDraft: draft,
    getLanguage: () => 'system',
    onInsert: (result) => inserted.push(result),
    newId: () => `op-${(ids += 1)}`,
  })
  return { session, lease, inserted }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => vi.useRealTimers())

describe('voice session', () => {
  it('records, transcribes and inserts once at the original selection', async () => {
    const { engine, log } = fakeEngine()
    const { session, lease, inserted } = setup(engine, () => ({ draftKey: target.draftKey, revision: 1, text: 'Fix' }))
    expect(session.start({ ...target, selection: { start: 3, end: 3 } })).toBe(true)
    expect(session.snapshot().state.phase).toBe('preparing')
    await tick()
    expect(session.snapshot().state.phase).toBe('recording')
    session.stop()
    await tick()
    await session.settled()
    expect(inserted).toEqual([{ text: 'Fix add retries', caret: 15 }])
    expect(session.snapshot().state.phase).toBe('idle')
    expect(lease.holder()).toBeUndefined()
    expect(log).toEqual(['start', 'stop', 'transcribe', 'dispose'])
  })

  it('blocks a second take while one owns the microphone', async () => {
    const { engine } = fakeEngine()
    const a = setup(engine)
    expect(a.session.start(target)).toBe(true)
    expect(a.session.start({ ...target, draftKey: 'other' })).toBe(false)
    const b = createVoiceSession({
      engine,
      lease: a.lease,
      getDraft: () => ({ draftKey: 'x', revision: 1, text: '' }),
      getLanguage: () => 'system',
      onInsert: () => {},
    })
    expect(b.start({ ...target, draftKey: 'x' })).toBe(false)
  })

  it('cancel makes the result ineligible at once but keeps the lease until native work settled', async () => {
    const { engine, nativeCancel } = fakeEngine()
    const { session, lease, inserted } = setup(engine)
    session.start(target)
    await tick()
    session.cancel()
    expect(session.snapshot().state.phase).toBe('idle')
    expect(session.snapshot().cleaning).toBe(true)
    expect(lease.holder()).toBe('op-1')
    expect(session.start(target)).toBe(false)
    nativeCancel.resolve()
    await session.settled()
    expect(lease.holder()).toBeUndefined()
    expect(session.snapshot().cleaning).toBe(false)
    expect(inserted).toEqual([])
    expect(session.start(target)).toBe(true)
  })

  it('a late transcript after cancel never inserts and never frees a newer take', async () => {
    const late = deferred<string>()
    const { engine, log } = fakeEngine({ transcript: late.promise })
    const { session, lease, inserted } = setup(engine)
    session.start(target)
    await tick()
    session.stop()
    await tick()
    expect(session.snapshot().state.phase).toBe('transcribing')
    session.cancel()
    expect(log).toContain('aborted')
    expect(lease.holder()).toBe('op-1')
    late.resolve('too late')
    await session.settled()
    expect(inserted).toEqual([])
    expect(session.snapshot().state.phase).toBe('idle')
    expect(lease.holder()).toBeUndefined()
    expect(log.filter((entry) => entry === 'dispose')).toHaveLength(1)
  })

  it('cancelling while preparing releases the engine after it starts', async () => {
    const gate = deferred()
    const { engine, log, nativeCancel } = fakeEngine({ startGate: gate.promise })
    const { session, lease } = setup(engine)
    session.start(target)
    session.cancel()
    gate.resolve()
    await tick()
    expect(log).toContain('cancel')
    expect(lease.holder()).toBe('op-1')
    nativeCancel.resolve()
    await session.settled()
    expect(lease.holder()).toBeUndefined()
    expect(session.snapshot().state.phase).toBe('idle')
  })

  it('reports permission and unavailable failures separately and frees the lease', async () => {
    for (const reason of ['permission', 'unavailable', 'model'] as const) {
      const { engine } = fakeEngine({ startError: new VoiceError(reason) })
      const { session, lease } = setup(engine)
      session.start(target)
      await tick()
      expect(session.snapshot().state).toEqual({ phase: 'failed', reason })
      expect(lease.holder()).toBeUndefined()
    }
    const { session } = setup(UNAVAILABLE_VOICE_ENGINE)
    session.start(target)
    await tick()
    expect(session.snapshot().state).toEqual({ phase: 'failed', reason: 'unavailable' })
  })

  it('a system interruption cancels the take, says why and keeps the draft', async () => {
    const { engine, options, nativeCancel } = fakeEngine()
    const { session, inserted } = setup(engine)
    session.start(target)
    await tick()
    options().onInterrupt()
    expect(session.snapshot().state).toEqual({ phase: 'failed', reason: 'interrupted' })
    nativeCancel.resolve()
    await session.settled()
    expect(inserted).toEqual([])
  })

  it('a scope change discards silently', async () => {
    const { engine, nativeCancel } = fakeEngine()
    const { session } = setup(engine)
    session.start(target)
    await tick()
    session.interrupt('scope')
    expect(session.snapshot().state.phase).toBe('idle')
    nativeCancel.resolve()
    await session.settled()
  })

  it('the cap stops at Recording limit reached and waits for Transcribe or Discard', async () => {
    vi.useFakeTimers()
    const { engine } = fakeEngine()
    const { session, inserted } = setup(engine)
    session.start(target)
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(DICTATION_MAX_MS)
    expect(session.snapshot().state.phase).toBe('limit')
    expect(inserted).toEqual([])
    session.stop()
    await vi.advanceTimersByTimeAsync(1)
    await session.settled()
    expect(inserted).toHaveLength(1)
  })

  it('an adapter that stops at its own cap moves to the same limit state', async () => {
    const { engine, options } = fakeEngine()
    const { session } = setup(engine)
    session.start(target)
    await tick()
    options().onLimit?.()
    expect(session.snapshot().state.phase).toBe('limit')
  })

  it('an edited draft holds the transcript for review instead of overwriting', async () => {
    let revision = 1
    const { engine } = fakeEngine()
    const { session, inserted } = setup(engine, () => ({ draftKey: target.draftKey, revision, text: 'Fix it' }))
    session.start(target)
    await tick()
    revision = 2
    session.stop()
    await tick()
    await session.settled()
    expect(inserted).toEqual([])
    expect(session.snapshot().state).toEqual({ phase: 'review', draftKey: target.draftKey, text: 'add retries' })
    expect(session.insertReview({ draftKey: target.draftKey, revision: 2, text: 'Fix it' }, { start: 3, end: 3 })).toBe(
      true,
    )
    expect(inserted).toEqual([{ text: 'Fix add retries it', caret: 15 }])
    expect(session.snapshot().state.phase).toBe('idle')
  })

  it('a transcript for another draft is dropped, and silence reports empty', async () => {
    const other = fakeEngine()
    const a = setup(other.engine, () => ({ draftKey: 'other', revision: 1, text: '' }))
    a.session.start(target)
    await tick()
    a.session.stop()
    await tick()
    expect(a.session.snapshot().state.phase).toBe('idle')
    expect(a.inserted).toEqual([])
    const quiet = fakeEngine({ transcript: Promise.resolve('  ') })
    const b = setup(quiet.engine)
    b.session.start(target)
    await tick()
    b.session.stop()
    await tick()
    expect(b.session.snapshot().state).toEqual({ phase: 'failed', reason: 'empty' })
  })

  it('a recognition error disposes the audio and frees the microphone', async () => {
    const { engine, log } = fakeEngine({ transcript: () => Promise.reject(new VoiceError('model')) })
    const { session, lease } = setup(engine)
    session.start(target)
    await tick()
    session.stop()
    await tick()
    await session.settled()
    expect(session.snapshot().state).toEqual({ phase: 'failed', reason: 'model' })
    expect(log).toContain('dispose')
    expect(lease.holder()).toBeUndefined()
  })
})
