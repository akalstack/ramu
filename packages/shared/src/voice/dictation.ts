// Platform-independent dictation state: what a take owns, when it must be discarded, and where its text may land.
// Capture and recognition are native and live elsewhere; nothing here touches audio, a host or the draft store.

/** Initial recording cap. A capped take stops and waits for an explicit Transcribe or Discard. */
export const DICTATION_MAX_MS = 5 * 60_000

export interface DraftSelection {
  start: number
  end: number
}

/** The draft a take belongs to, captured when recording starts. */
export interface DictationTarget {
  /** Host-qualified draft identity, so a take never lands in another thread or host's composer. */
  draftKey: string
  /** The draft's revision at the start; any later edit makes the insertion point untrustworthy. */
  revision: number
  selection: DraftSelection
}

export type DictationState =
  | { phase: 'idle' }
  | { phase: 'recording'; target: DictationTarget; startedAt: number }
  | { phase: 'limit'; target: DictationTarget; startedAt: number }
  | { phase: 'transcribing'; target: DictationTarget; startedAt: number }
  | { phase: 'failed'; reason: DictationFailure }

export type DictationFailure = 'permission' | 'unavailable' | 'capture' | 'recognition' | 'empty' | 'interrupted'

export type DictationEvent =
  | { type: 'start'; target: DictationTarget; now: number }
  | { type: 'tick'; now: number }
  | { type: 'stop' }
  | { type: 'cancel' }
  /** The scope changed (thread, host, window, screen) or the app was interrupted (call, route loss, background, lock). */
  | { type: 'interrupt'; reason: 'scope' | 'system' }
  | { type: 'failed'; reason: DictationFailure }
  | { type: 'done' }

export const IDLE: DictationState = { phase: 'idle' }

/** A take is active while capture or recognition is running or waiting on the person; the draft is frozen then. */
export const dictationBusy = (state: DictationState): boolean =>
  state.phase === 'recording' || state.phase === 'limit' || state.phase === 'transcribing'

export function reduceDictation(state: DictationState, event: DictationEvent): DictationState {
  switch (event.type) {
    case 'start':
      // One take at a time; starting again never replaces a take that is still running.
      return dictationBusy(state) ? state : { phase: 'recording', target: event.target, startedAt: event.now }
    case 'tick':
      return state.phase === 'recording' && event.now - state.startedAt >= DICTATION_MAX_MS
        ? { phase: 'limit', target: state.target, startedAt: state.startedAt }
        : state
    case 'stop':
      return state.phase === 'recording' || state.phase === 'limit'
        ? { phase: 'transcribing', target: state.target, startedAt: state.startedAt }
        : state
    case 'cancel':
      return dictationBusy(state) || state.phase === 'failed' ? IDLE : state
    case 'interrupt':
      // Existing text is untouched either way; a system interruption says why, a scope change is silent.
      return !dictationBusy(state)
        ? state
        : event.reason === 'system'
          ? { phase: 'failed', reason: 'interrupted' }
          : IDLE
    case 'failed':
      return { phase: 'failed', reason: event.reason }
    case 'done':
      return state.phase === 'transcribing' ? IDLE : state
  }
}

export type Insertion =
  | { kind: 'inserted'; text: string; caret: number }
  | { kind: 'conflict'; reason: 'draft' | 'edited' }
  | { kind: 'empty' }

/**
 * Where a finished transcript goes: at the original selection, only into the draft that started the take and only if
 * it was not edited since. Otherwise the text is offered back rather than placed where it was not asked for.
 */
export function insertTranscript(
  draft: { draftKey: string; revision: number; text: string },
  target: DictationTarget,
  transcript: string,
): Insertion {
  const spoken = transcript.replace(/\s+/g, ' ').trim()
  if (!spoken) return { kind: 'empty' }
  if (draft.draftKey !== target.draftKey) return { kind: 'conflict', reason: 'draft' }
  if (draft.revision !== target.revision) return { kind: 'conflict', reason: 'edited' }
  const start = Math.max(0, Math.min(target.selection.start, draft.text.length))
  const end = Math.max(start, Math.min(target.selection.end, draft.text.length))
  const before = draft.text.slice(0, start)
  const after = draft.text.slice(end)
  // Keep words apart without doubling spaces or adding one at a line start.
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) ? ' ' : ''
  const inserted = `${lead}${spoken}${trail}`
  return { kind: 'inserted', text: `${before}${inserted}${after}`, caret: before.length + lead.length + spoken.length }
}
