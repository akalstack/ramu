import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentEvent, AgentSessionInfo, AgentSessionState, QueuedMessage } from '@ramu/shared/types'
import { cachedDataOn, ipcQueryKeyOn, queryClient } from '../../../dataQueries'
import { ramu } from '../../../ipc'
import { ownHostId } from '../../../hosts'
import { errorText } from '../../../workspace/TaskPane'
import { useHost } from '../../../workspace/HostProvider'
import { useHostRuntime } from '../../../workspace/workspace'
import { heldTranscript, holdTranscript, lastSeqOf } from '../lib/heldTranscripts'

/** Longest a streamed event waits to be shown: a burst rebuilds the transcript once, not once per event. */
const STREAM_FRAME_MS = 33
const STREAMED_KINDS = new Set<AgentEvent['kind']>(['text', 'thinking', 'tool-use', 'tool-result'])

const eventsOf = (rows: ReadonlyMap<number, { event: AgentEvent }>) =>
  [...rows].sort(([a], [b]) => a - b).map(([, item]) => item.event)
const latestQueue = (events: readonly AgentEvent[]) => {
  const queue = events.findLast((e) => e.kind === 'queue')
  return queue?.kind === 'queue' ? queue : undefined
}

/** What a chat shows first: the rows this client kept, else the query cache (which has no host sequence numbers). */
function seedOf(host: string, sessionId: string) {
  const kept = heldTranscript(host, sessionId)
  if (kept) return { events: eventsOf(kept.rows), rows: kept.rows, cursor: kept.cursor }
  const events = cachedDataOn(host, 'agent.events', sessionId)
  if (!events) return null
  return { events, rows: new Map(events.map((event, index) => [index + 1, { event }])), cursor: 0 }
}

/**
 * A chat's session and events: seeded from the query cache, hydrated from the host, then kept current by live
 * events. Also exposes the queued messages the host reports and the last error to show above the message box.
 */
export function useAgentStream(sessionId: string) {
  // The chat's host: its cache entries, its calls and its events.
  const { id: host, invoke } = useHost()
  const { on } = useHostRuntime()
  // Uncached reads for the query functions below (the cached `invoke` would read through the same keys).
  const own = host === ownHostId()
  // Keep these queries observed while the chat is mounted. Hydration and live
  // events below reconcile revisions; observers only manage cache lifetime.
  useQuery({
    queryKey: ipcQueryKeyOn(host, 'agent.get', sessionId),
    queryFn: () => (own ? ramu.invoke('agent.get', sessionId) : ramu.invokeOn(host, 'agent.get', sessionId)),
    enabled: false,
    notifyOnChangeProps: [],
  })
  useQuery({
    queryKey: ipcQueryKeyOn(host, 'agent.events', sessionId),
    queryFn: () => (own ? ramu.invoke('agent.events', sessionId) : ramu.invokeOn(host, 'agent.events', sessionId)),
    enabled: false,
    notifyOnChangeProps: [],
  })
  const [initial] = useState(() => seedOf(host, sessionId))
  const [eventSequences, setEventSequences] = useState<Map<AgentEvent, number>>(
    () => new Map([...(initial?.rows ?? [])].map(([seq, item]) => [item.event, seq])),
  )
  const [queuePaused, setQueuePaused] = useState(() => !!latestQueue(initial?.events ?? [])?.paused)
  const [queued, setQueued] = useState<QueuedMessage[]>(() => latestQueue(initial?.events ?? [])?.messages ?? [])
  const [hydrating, setHydrating] = useState(() => !initial)
  const [session, setSession] = useState<AgentSessionInfo | null>(
    () => cachedDataOn(host, 'agent.get', sessionId) ?? null,
  )
  const [events, setEvents] = useState<AgentEvent[]>(() => initial?.events ?? [])
  const [liveText, setLiveText] = useState<AgentEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cached = seedOf(host, sessionId)
    setHydrating(!cached)
    setError(null)
    let cancelled = false,
      revision = 0,
      latestState: AgentSessionState | undefined
    const stored = new Map<number, { event: AgentEvent; revision: number }>(
      [...(cached?.rows ?? [])].map(([seq, item]) => [seq, { event: item.event, revision: 0 }]),
    )
    // What this client already holds: the host's change counter, so a read returns only the rows that changed.
    let cursor = cached?.cursor ?? 0
    let frame: ReturnType<typeof setTimeout> | undefined
    const refreshEvents = () => {
      clearTimeout(frame)
      frame = undefined
      setEventSequences(new Map([...stored].map(([seq, item]) => [item.event, seq])))
      const list = eventsOf(stored)
      setEvents(list)
      queryClient.setQueryData(ipcQueryKeyOn(host, 'agent.events', sessionId), list)
      const queue = latestQueue(list)
      if (queue) {
        setQueued(queue.messages)
        setQueuePaused(!!queue.paused)
      }
      holdTranscript(host, sessionId, { rows: stored, cursor })
    }
    const refreshSoon = () => {
      frame ??= setTimeout(refreshEvents, STREAM_FRAME_MS)
    }
    let changesSupported = true
    const read = async (requestedAt: number) => {
      if (changesSupported) {
        try {
          const result = await invoke('agent.changes', sessionId, cursor, lastSeqOf(stored))
          if (cancelled) return false
          if (result.reset) {
            const kept = new Set(result.events.map((row) => row.seq))
            for (const [seq, item] of [...stored])
              if (!kept.has(seq) && item.revision <= requestedAt) stored.delete(seq)
          }
          for (const row of result.events)
            if ((stored.get(row.seq)?.revision ?? -1) <= requestedAt)
              stored.set(row.seq, { event: row.event, revision: requestedAt })
          cursor = result.cursor
          return result.reset || result.events.length > 0
        } catch (e) {
          // A host from before agent.changes reads the whole transcript every time.
          if (/unknown method/i.test(errorText(e))) changesSupported = false
          else throw e
        }
      }
      const evs = await invoke('agent.events', sessionId)
      if (cancelled) return false
      evs.forEach((event, index) => {
        if ((stored.get(index + 1)?.revision ?? -1) <= requestedAt)
          stored.set(index + 1, { event, revision: requestedAt })
      })
      return true
    }
    const hydrate = async () => {
      const requestedAt = revision
      const [s, changed] = await Promise.all([invoke('agent.get', sessionId), read(requestedAt)])
      if (cancelled) return
      setSession({ ...s, state: latestState ?? s.state })
      // Nothing new: the rows on screen stay the same objects, so a reopened chat renders nothing twice.
      if (changed || !cached) refreshEvents()
      setHydrating(false)
    }
    setEvents(cached?.events ?? [])
    setEventSequences(new Map([...stored].map(([seq, item]) => [item.event, seq])))
    const queue = latestQueue(cached?.events ?? [])
    setQueued(queue?.messages ?? [])
    setQueuePaused(!!queue?.paused)
    setLiveText(null)
    void hydrate().catch((e) => {
      if (!cancelled) {
        setError(errorText(e))
        setHydrating(false)
      }
    })
    const reconnect = on('background:connection', ({ connected }) => {
      if (connected) void hydrate().catch(() => {})
    })
    // A rewind removes the edited message and everything after it.
    const rewound = on('agent:rewound', ({ sessionId: eventSessionId, seq }) => {
      if (eventSessionId !== sessionId) return
      revision++
      for (const key of [...stored.keys()]) if (key >= seq) stored.delete(key)
      setLiveText(null)
      refreshEvents()
    })
    const off = on('agent:event', ({ sessionId: eventSessionId, event, seq }) => {
      if (eventSessionId !== sessionId) return
      revision++
      if (event.kind === 'state') {
        latestState = event.state
        setSession((s) => (s ? { ...s, state: event.state } : s))
        if (event.at === undefined) return
      }
      if (event.agentId && event.kind !== 'agent') {
        /* sub-agent output never streams into the main reply */
      } else if (event.kind === 'text') setLiveText(event)
      else if (event.kind === 'tool-use' || event.kind === 'result') setLiveText(null)
      if (seq !== undefined) stored.set(seq, { event, revision })
      else {
        const sameMessage =
          event.kind === 'text' && event.messageId
            ? [...stored].find(([, i]) => i.event.kind === 'text' && i.event.messageId === event.messageId)?.[0]
            : undefined
        stored.set(sameMessage ?? lastSeqOf(stored) + 1, { event, revision })
      }
      // Only what streams is coalesced: a sent message must replace its pending bubble in the same frame.
      if (STREAMED_KINDS.has(event.kind)) refreshSoon()
      else refreshEvents()
      if (event.kind === 'settings')
        setSession((s) => (s ? { ...s, provider: event.settings.provider, settings: event.settings } : s))
    })
    return () => {
      cancelled = true
      // Rows that arrived in the last frame still belong to what this client holds.
      if (frame !== undefined) refreshEvents()
      else if (stored.size) holdTranscript(host, sessionId, { rows: stored, cursor })
      off()
      rewound()
      reconnect()
    }
  }, [sessionId, host, invoke, on])

  useEffect(() => {
    if (session) queryClient.setQueryData(ipcQueryKeyOn(host, 'agent.get', sessionId), session)
  }, [session, sessionId, host])

  return { session, setSession, events, eventSequences, liveText, queued, queuePaused, hydrating, error, setError }
}
