import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentEvent, AgentSessionInfo, AgentSessionState, QueuedMessage } from '@ramu/shared/types'
import { cachedDataOn, ipcQueryKeyOn, queryClient } from '../../../dataQueries'
import { ramu } from '../../../ipc'
import { ownHostId } from '../../../hosts'
import { errorText } from '../../../workspace/TaskPane'
import { useHost } from '../../../workspace/HostProvider'
import { useHostRuntime } from '../../../workspace/workspace'

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
  const [eventSequences, setEventSequences] = useState<Map<AgentEvent, number>>(
    () => new Map((cachedDataOn(host, 'agent.events', sessionId) ?? []).map((event, i) => [event, i + 1])),
  )
  const [queuePaused, setQueuePaused] = useState(false)
  const [queued, setQueued] = useState<QueuedMessage[]>([])
  const [hydrating, setHydrating] = useState(() => !cachedDataOn(host, 'agent.events', sessionId))
  const [session, setSession] = useState<AgentSessionInfo | null>(
    () => cachedDataOn(host, 'agent.get', sessionId) ?? null,
  )
  const [events, setEvents] = useState<AgentEvent[]>(() => cachedDataOn(host, 'agent.events', sessionId) ?? [])
  const [liveText, setLiveText] = useState<AgentEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cached = cachedDataOn(host, 'agent.events', sessionId)
    setHydrating(!cached)
    setError(null)
    let cancelled = false,
      revision = 0,
      latestState: AgentSessionState | undefined
    const stored = new Map<number, { event: AgentEvent; revision: number }>(
      (cached ?? []).map((event, index) => [index + 1, { event, revision: 0 }]),
    )
    const refreshEvents = () => {
      setEventSequences(new Map([...stored].map(([seq, item]) => [item.event, seq])))
      const list = [...stored].sort(([a], [b]) => a - b).map(([, item]) => item.event)
      setEvents(list)
      queryClient.setQueryData(ipcQueryKeyOn(host, 'agent.events', sessionId), list)
      const queue = list.findLast((e) => e.kind === 'queue')
      if (queue?.kind === 'queue') {
        setQueued(queue.messages)
        setQueuePaused(!!queue.paused)
      }
    }
    const hydrate = async () => {
      const requestedAt = revision
      const [s, evs] = await Promise.all([invoke('agent.get', sessionId), invoke('agent.events', sessionId)])
      if (cancelled) return
      evs.forEach((event, index) => {
        if ((stored.get(index + 1)?.revision ?? -1) <= requestedAt)
          stored.set(index + 1, { event, revision: requestedAt })
      })
      setSession({ ...s, state: latestState ?? s.state })
      refreshEvents()
      setHydrating(false)
    }
    setEvents(cached ?? [])
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
        stored.set(sameMessage ?? Math.max(0, ...stored.keys()) + 1, { event, revision })
      }
      refreshEvents()
      if (event.kind === 'settings')
        setSession((s) => (s ? { ...s, provider: event.settings.provider, settings: event.settings } : s))
    })
    return () => {
      cancelled = true
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
