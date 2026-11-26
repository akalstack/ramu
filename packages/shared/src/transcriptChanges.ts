import type { AgentEvent } from './types'

/** What `agent.changes` answers: the rows that changed since a cursor, or a full snapshot when `reset`. */
export interface TranscriptChanges {
  reset: boolean
  cursor: number
  lastSeq: number
  revision: number
  events: { seq: number; event: AgentEvent }[]
  /** A long catch-up came in parts and this is not the last: ask again from `cursor`. */
  more?: boolean
}

type ReadChanges = (cursor: number, knownLastSeq: number, paged: boolean) => Promise<TranscriptChanges>

const hosts = new Map<string, { unpaged?: boolean }>()

/** What this client learned about one host's support for parts, kept while the app runs. */
export function pagingOf(host: string): { unpaged?: boolean } {
  let known = hosts.get(host)
  if (!known) hosts.set(host, (known = {}))
  return known
}

/** Far more parts than any thread needs; a host that kept saying `more` would otherwise never let the read end. */
const MAX_PARTS = 500

/**
 * Reads everything that changed since `cursor`, asking for a long catch-up in parts so no single answer carries a
 * whole transcript. `host.unpaged` remembers a host too old to know about parts, which is then asked the old way.
 * A part that turns into a snapshot (the cursor stopped being usable midway) replaces what was gathered.
 */
export async function readTranscriptChanges(
  read: ReadChanges,
  cursor: number,
  knownLastSeq: number,
  host: { unpaged?: boolean },
): Promise<TranscriptChanges> {
  const part = async (from: number): Promise<TranscriptChanges> => {
    if (host.unpaged) return read(from, knownLastSeq, false)
    try {
      return await read(from, knownLastSeq, true)
    } catch (error) {
      // An older host refuses the extra argument. Only if the plain call works is that the reason.
      const plain = await read(from, knownLastSeq, false).catch(() => null)
      if (!plain) throw error
      host.unpaged = true
      return plain
    }
  }
  let result = await part(cursor)
  const events = [...result.events]
  for (let parts = 1; result.more && !result.reset && parts < MAX_PARTS; parts++) {
    result = await part(result.cursor)
    if (result.reset) return result
    events.push(...result.events)
  }
  return { reset: result.reset, cursor: result.cursor, lastSeq: result.lastSeq, revision: result.revision, events }
}
