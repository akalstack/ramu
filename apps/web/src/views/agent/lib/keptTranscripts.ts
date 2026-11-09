import type { AgentEvent, AgentSessionInfo } from '@ramu/shared/types'

/**
 * Another host's recent threads, kept on this device so they still open while that host is unreachable or after a
 * restart: the session (so the composer can queue into the outbox) and its last rows. Unlike the in-memory held
 * transcripts these carry no change cursor, so the first read after reconnecting is a full one.
 */
export interface KeptTranscript {
  session: AgentSessionInfo | null
  rows: Map<number, { event: AgentEvent }>
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const INDEX = 'ramu.transcripts'
const keyOf = (sessionId: string) => `ramu.transcript.${sessionId}`
/** Threads kept per host, most recently opened first. */
export const MAX_KEPT_TRANSCRIPTS = 8
/** Per thread, in characters of JSON; the oldest rows are left out beyond it so storage stays inside its quota. */
export const MAX_TRANSCRIPT_CHARS = 250_000

function readIndex(store: Store): string[] {
  try {
    const index = JSON.parse(store.getItem(INDEX) ?? '[]') as unknown
    return Array.isArray(index) ? index.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function readKeptTranscript(store: Store, sessionId: string): KeptTranscript | null {
  try {
    const saved = JSON.parse(store.getItem(keyOf(sessionId)) ?? 'null') as {
      session?: AgentSessionInfo | null
      rows?: [number, AgentEvent][]
    } | null
    if (!saved || !Array.isArray(saved.rows)) return null
    return {
      session: saved.session ?? null,
      rows: new Map(
        saved.rows
          .filter((row) => Array.isArray(row) && typeof row[0] === 'number' && row[1])
          .map(([seq, event]) => [seq, { event }]),
      ),
    }
  } catch {
    return null
  }
}

/** Saves the thread as most recent, dropping the least recently kept beyond the limit. */
export function writeKeptTranscript(store: Store, sessionId: string, transcript: KeptTranscript) {
  let rows = [...transcript.rows].sort(([a], [b]) => a - b).map(([seq, item]) => [seq, item.event] as const)
  let text = JSON.stringify({ session: transcript.session, rows })
  // Halving keeps this to a few serialisations even for a very long thread.
  while (text.length > MAX_TRANSCRIPT_CHARS && rows.length > 1) {
    rows = rows.slice(Math.ceil(rows.length / 2))
    text = JSON.stringify({ session: transcript.session, rows })
  }
  if (text.length > MAX_TRANSCRIPT_CHARS) text = JSON.stringify({ session: transcript.session, rows: [] })
  const index = [sessionId, ...readIndex(store).filter((id) => id !== sessionId)]
  try {
    for (const dropped of index.slice(MAX_KEPT_TRANSCRIPTS)) store.removeItem(keyOf(dropped))
    store.setItem(keyOf(sessionId), text)
    store.setItem(INDEX, JSON.stringify(index.slice(0, MAX_KEPT_TRANSCRIPTS)))
  } catch {
    // Storage full or unavailable: the thread still reads from the host when it is reachable.
  }
}

/**
 * Coalesces saves per thread: a streaming turn changes the transcript many times a second, and only its latest state
 * needs to be on disk.
 */
export function createTranscriptKeeper(storeFor: (host: string) => Store | null, delay = 1500) {
  const pending = new Map<string, { host: string; sessionId: string; transcript: Partial<KeptTranscript> }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const flush = (key: string) => {
    clearTimeout(timers.get(key))
    timers.delete(key)
    const entry = pending.get(key)
    pending.delete(key)
    const store = entry && storeFor(entry.host)
    if (!entry || !store) return
    const before = readKeptTranscript(store, entry.sessionId)
    const transcript = {
      session: entry.transcript.session ?? before?.session ?? null,
      rows: entry.transcript.rows ?? before?.rows ?? new Map(),
    }
    if (transcript.session || transcript.rows.size) writeKeptTranscript(store, entry.sessionId, transcript)
  }
  return {
    read(host: string, sessionId: string): KeptTranscript | null {
      const store = storeFor(host)
      if (!store) return null
      const saved = readKeptTranscript(store, sessionId)
      const waiting = pending.get(JSON.stringify([host, sessionId]))?.transcript
      if (!saved && !waiting) return null
      return {
        session: waiting?.session ?? saved?.session ?? null,
        rows: waiting?.rows ?? saved?.rows ?? new Map(),
      }
    },
    keep(host: string, sessionId: string, transcript: Partial<KeptTranscript>) {
      if (!storeFor(host)) return
      const key = JSON.stringify([host, sessionId])
      const entry = pending.get(key)
      pending.set(key, { host, sessionId, transcript: { ...entry?.transcript, ...transcript } })
      if (!timers.has(key))
        timers.set(
          key,
          setTimeout(() => flush(key), delay),
        )
    },
    flushAll() {
      for (const key of [...pending.keys()]) flush(key)
    },
  }
}
