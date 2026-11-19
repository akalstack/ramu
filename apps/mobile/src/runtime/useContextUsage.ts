import { useEffect, useState } from 'react'
import { compactBeforeSend, compactBeforeSendFrom } from '@ramu/shared/chat/compaction'
import type { AgentProvider, ContextUsage } from '@ramu/shared/types'
import { useStore } from './store'

/** The longest delay a timer takes; a later expiry is looked at again when this one fires. */
const MAX_TIMER_MS = 2_147_483_647

/** A thread's latest context reading, kept current while its host is online. */
export function useContextUsage(computerId: string, sessionId: string | null): ContextUsage | null {
  const store = useStore()
  const [context, setContext] = useState<ContextUsage | null>(null)
  const online = !!computerId && store.isOnline(computerId)
  useEffect(() => {
    setContext(null)
    if (!sessionId || !online) return
    let alive = true
    void store.invoke(computerId, 'agent.context', sessionId).then(
      (value) => {
        if (alive) setContext(value)
      },
      () => {},
    )
    const unwatch = store.watch(computerId, ['context:changed'], { 'context:changed': [sessionId] })
    const off = store.subscribe(computerId, (channel, payload) => {
      if (channel === 'context:changed' && payload.sessionId === sessionId) setContext(payload.context)
    })
    return () => {
      alive = false
      off()
      unwatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [computerId, sessionId, online] by design; the values it reads beyond these are current as of that run
  }, [computerId, sessionId, online])
  return context
}

/**
 * The tokens an idle Claude thread would re-read in full with its next message, once its prompt cache has expired, or
 * null while compacting first would save nothing. Re-checks on its own when the cache runs out with the thread open.
 */
export function useCompactOffer(
  provider: AgentProvider | undefined,
  idle: boolean,
  context: ContextUsage | null,
): number | null {
  const [now, setNow] = useState(() => Date.now())
  const from = provider ? compactBeforeSendFrom(provider, context) : null
  useEffect(() => {
    if (from === null || now >= from) return
    const wait = from - Date.now()
    if (wait <= 0) {
      setNow(Date.now())
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.min(wait, MAX_TIMER_MS))
    return () => clearTimeout(timer)
  }, [from, now])
  return provider ? compactBeforeSend({ provider, idle, context, now }) : null
}
