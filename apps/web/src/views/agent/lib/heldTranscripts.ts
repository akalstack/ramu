import type { AgentEvent } from '@ramu/shared/types'

/** A transcript as the host numbers it, with the host's change counter for those rows. */
export interface HeldTranscript {
  rows: ReadonlyMap<number, { event: AgentEvent }>
  cursor: number
}

/** Enough for moving between recent threads; an older one reads its transcript again. */
const MAX_HELD = 24

const held = new Map<string, HeldTranscript>()
const keyOf = (host: string, sessionId: string) => JSON.stringify([host, sessionId])

/** Outlives the chat's view, so reopening a thread reads only what changed instead of its whole transcript. */
export function heldTranscript(host: string, sessionId: string): HeldTranscript | undefined {
  return held.get(keyOf(host, sessionId))
}

export function holdTranscript(host: string, sessionId: string, transcript: HeldTranscript) {
  const key = keyOf(host, sessionId)
  // Re-inserting keeps the map in order of use, so the oldest entry is the one to drop.
  held.delete(key)
  held.set(key, transcript)
  if (held.size > MAX_HELD) held.delete(held.keys().next().value!)
}

export const lastSeqOf = (rows: ReadonlyMap<number, unknown>) => {
  let last = 0
  for (const seq of rows.keys()) if (seq > last) last = seq
  return last
}
