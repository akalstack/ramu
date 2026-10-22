// Runs one dictation take against a device engine. The pure rules live in dictation.ts; this adds the resource
// ownership around them: one lease per device, an operation id so a late native callback cannot touch another take,
// and cancellation that makes a result ineligible at once but keeps the lease until native work has really settled.

import {
  DICTATION_MAX_BYTES,
  DICTATION_MAX_MS,
  IDLE,
  reduceDictation,
  insertTranscript,
  type DictationEvent,
  type DictationFailure,
  type DictationState,
  type DictationTarget,
  type DraftSelection,
} from './dictation'
import { VoiceError, type VoiceAudio, type VoiceEngine, type VoiceLease, type VoiceRecording } from './engine'

export interface VoiceDraft {
  draftKey: string
  revision: number
  text: string
}

export interface VoiceSnapshot {
  state: DictationState
  /** Microphone level 0..1 while recording. */
  level: number
  /** A cancelled or finished take is still releasing native resources; a new take cannot start yet. */
  cleaning: boolean
}

export interface VoiceSessionOptions {
  engine: VoiceEngine
  lease: VoiceLease
  /** The draft the composer holds right now, read when the transcript arrives. */
  getDraft: () => VoiceDraft
  /** Speech language setting: `system` or a BCP 47 tag. */
  getLanguage: () => string
  getInputDeviceId?: () => string | undefined
  /** Receives the draft text with the transcript inserted, as one edit. */
  onInsert: (result: { text: string; caret: number }) => void
  now?: () => number
  newId?: () => string
}

export interface VoiceSession {
  snapshot(): VoiceSnapshot
  subscribe(listener: () => void): () => void
  /** Starts recording for `target`. Returns false when another take owns the microphone. */
  start(target: DictationTarget): boolean
  /** Stops capture and transcribes. Also answers the limit prompt with Transcribe. */
  stop(): void
  /** Discards the take, or the transcript waiting for review. */
  cancel(): void
  /** The draft's scope or the app changed under the take. A system interruption is reported; a scope change is silent. */
  interrupt(reason: 'scope' | 'system'): void
  /** Review: insert the waiting transcript at the current cursor of the same draft. */
  insertReview(draft: VoiceDraft, selection: DraftSelection): boolean
  /** Resolves when native cleanup of all earlier takes finished. */
  settled(): Promise<void>
}

interface Operation {
  id: string
  cancelled: boolean
  abort: AbortController
  recording?: VoiceRecording
  /** Capture has been handed to the transcriber; cancelling must wait for that work, not stop capture again. */
  stopped?: boolean
  released?: boolean
  work?: Promise<unknown>
  timer?: ReturnType<typeof setTimeout>
}

const failureOf = (error: unknown): DictationFailure => (error instanceof VoiceError ? error.reason : 'recognition')

export function createVoiceSession(options: VoiceSessionOptions): VoiceSession {
  const { engine, lease } = options
  const now = options.now ?? Date.now
  let counter = 0
  const newId = options.newId ?? (() => `voice-${now()}-${(counter += 1)}`)
  let state: DictationState = IDLE
  let level = 0
  let current: Operation | undefined
  const cleanups = new Set<Promise<void>>()
  const listeners = new Set<() => void>()
  let snap: VoiceSnapshot = { state, level, cleaning: false }

  const publish = () => {
    snap = { state, level, cleaning: cleanups.size > 0 }
    for (const listener of listeners) listener()
  }
  const dispatch = (event: DictationEvent) => {
    const next = reduceDictation(state, event)
    if (next === state) return
    state = next
    if (state.phase !== 'recording') level = 0
    publish()
  }
  const isCurrent = (op: Operation) => current === op && !op.cancelled

  /** Holds the lease until the work really finished, so a still-running native call cannot overlap a new take. */
  const settle = (op: Operation, pending: Promise<unknown> | undefined) => {
    if (op.released) return
    op.released = true
    const done: Promise<void> = Promise.resolve(pending)
      .catch(() => undefined)
      .then(() => {
        lease.release(op.id)
        cleanups.delete(done)
        publish()
      })
    cleanups.add(done)
    publish()
  }

  const abandon = (op: Operation) => {
    op.cancelled = true
    op.abort.abort()
    if (op.timer) clearTimeout(op.timer)
    if (current === op) current = undefined
    settle(op, op.recording && !op.stopped ? op.recording.cancel() : op.work)
  }

  const runTranscription = async (op: Operation, recording: VoiceRecording) => {
    let audio: VoiceAudio | undefined
    try {
      audio = await recording.stop()
      const text = await engine.transcriber.transcribe(audio, options.getLanguage(), { signal: op.abort.signal })
      if (!isCurrent(op) || state.phase !== 'transcribing') return
      const target = state.target
      const outcome = insertTranscript(options.getDraft(), target, text)
      if (outcome.kind === 'inserted') {
        options.onInsert({ text: outcome.text, caret: outcome.caret })
        dispatch({ type: 'done' })
      } else if (outcome.kind === 'empty') {
        dispatch({ type: 'failed', reason: 'empty' })
      } else if (outcome.reason === 'edited') {
        dispatch({ type: 'review', draftKey: target.draftKey, text: text.replace(/\s+/g, ' ').trim() })
      } else {
        // Another draft is open now: the text is dropped rather than offered into the wrong thread.
        dispatch({ type: 'cancel' })
      }
    } catch (error) {
      if (isCurrent(op)) dispatch({ type: 'failed', reason: failureOf(error) })
    } finally {
      // The transcriber disposes on success; this covers a stop() or transcribe() that threw before taking over.
      await audio?.dispose().catch(() => undefined)
      if (current === op) current = undefined
      settle(op, undefined)
    }
  }

  return {
    snapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start(target) {
      if (state.phase === 'preparing' || state.phase === 'recording' || state.phase === 'limit') return false
      if (state.phase === 'transcribing') return false
      const id = newId()
      if (!lease.acquire(id)) return false
      const op: Operation = { id, cancelled: false, abort: new AbortController() }
      current = op
      state = IDLE
      dispatch({ type: 'prepare', target })
      const started = engine.capture
        .start({
          inputDeviceId: options.getInputDeviceId?.(),
          language: options.getLanguage(),
          maxMs: DICTATION_MAX_MS,
          maxBytes: DICTATION_MAX_BYTES,
          onLevel(value) {
            if (!isCurrent(op) || state.phase !== 'recording') return
            level = Math.max(0, Math.min(1, value))
            publish()
          },
          onInterrupt() {
            if (isCurrent(op)) {
              abandon(op)
              dispatch({ type: 'interrupt', reason: 'system' })
            }
          },
          onLimit() {
            if (isCurrent(op) && state.phase === 'recording')
              dispatch({ type: 'tick', now: state.startedAt + DICTATION_MAX_MS })
          },
        })
        .then(
          (recording) => {
            op.recording = recording
            // Cancelled while preparing: the take never counts, and the engine is released before reuse.
            if (op.cancelled) return recording.cancel()
            dispatch({ type: 'recording', now: now() })
            op.timer = setTimeout(() => {
              if (isCurrent(op) && state.phase === 'recording')
                dispatch({ type: 'tick', now: state.startedAt + DICTATION_MAX_MS })
            }, DICTATION_MAX_MS)
          },
          (error: unknown) => {
            if (isCurrent(op)) dispatch({ type: 'failed', reason: failureOf(error) })
            if (current === op) current = undefined
            // Nothing was captured, so the lease can go at once.
            settle(op, undefined)
          },
        )
      op.work = started
      return true
    },
    stop() {
      const op = current
      if (!op || !op.recording || (state.phase !== 'recording' && state.phase !== 'limit')) return
      if (op.timer) clearTimeout(op.timer)
      dispatch({ type: 'stop' })
      op.stopped = true
      op.work = runTranscription(op, op.recording)
    },
    cancel() {
      const op = current
      if (op) {
        abandon(op)
        dispatch({ type: 'cancel' })
      } else dispatch({ type: 'cancel' })
    },
    interrupt(reason) {
      const op = current
      if (op) abandon(op)
      dispatch({ type: 'interrupt', reason })
    },
    insertReview(draft, selection) {
      if (state.phase !== 'review' || draft.draftKey !== state.draftKey) return false
      const outcome = insertTranscript(
        draft,
        { draftKey: draft.draftKey, revision: draft.revision, selection },
        state.text,
      )
      if (outcome.kind !== 'inserted') return false
      options.onInsert({ text: outcome.text, caret: outcome.caret })
      state = IDLE
      publish()
      return true
    },
    settled: () => Promise.all([...cleanups]).then(() => undefined),
  }
}
