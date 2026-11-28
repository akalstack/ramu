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
  /** A snapshot coming in parts: the next part starts after this seq. */
  after?: number
}

type ReadChanges = (
  cursor: number,
  knownLastSeq: number,
  paged: boolean,
  snapshotAfter?: number,
) => Promise<TranscriptChanges>

/** What a client learned about a host: `unpaged` knows no parts at all, `wholeSnapshots` sends a snapshot in one answer. */
interface HostPaging {
  unpaged?: boolean
  wholeSnapshots?: boolean
}

const hosts = new Map<string, HostPaging>()

/** The optional arguments of `agent.changes` after the cursor, as a reader asks for them; none for an unpaged read. */
export const changeArgs = (paged: boolean, snapshotAfter?: number): [paged?: true, snapshotAfter?: number] =>
  !paged ? [] : snapshotAfter === undefined ? [true] : [true, snapshotAfter]

/** What this client learned about one host's support for parts, kept while the app runs. */
export function pagingOf(host: string): HostPaging {
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
  host: HostPaging,
): Promise<TranscriptChanges> {
  const paged = async (from: number): Promise<TranscriptChanges> => {
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
  const part = async (from: number, after = 0): Promise<TranscriptChanges> => {
    if (host.unpaged || host.wholeSnapshots) return paged(from)
    try {
      return await read(from, knownLastSeq, true, after)
    } catch (error) {
      // Only the first part can meet a host that sends snapshots whole; a later one failing is a real failure.
      if (after > 0) throw error
      const older = await paged(from).catch(() => null)
      if (!older) throw error
      host.wholeSnapshots = true
      return older
    }
  }
  let result = await part(cursor)
  if (result.reset && result.more && result.after !== undefined) {
    // A snapshot in parts: keep the first part's cursor, so rows edited while it was read still arrive next time.
    const first = result
    const events = [...result.events]
    for (let parts = 1; result.more && result.after !== undefined && parts < MAX_PARTS; parts++) {
      result = await part(first.cursor, result.after)
      events.push(...result.events)
    }
    return { reset: true, cursor: first.cursor, lastSeq: first.lastSeq, revision: first.revision, events }
  }
  const events = [...result.events]
  for (let parts = 1; result.more && !result.reset && parts < MAX_PARTS; parts++) {
    result = await part(result.cursor)
    if (result.reset) return result
    events.push(...result.events)
  }
  return { reset: result.reset, cursor: result.cursor, lastSeq: result.lastSeq, revision: result.revision, events }
}
