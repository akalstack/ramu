import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentEvent } from '@ramu/shared/types'
const request = (event: AgentEvent) =>
  ['question', 'permission-request', 'elicitation'].includes(event.kind) && 'requestId' in event
    ? event.requestId
    : null
/** New request cards wait for a quiet second; existing requests and all agent output stay live. */
export function useDeferredRequests(events: AgentEvent[], draft: string): AgentEvent[] {
  const [allowed, setAllowed] = useState<Set<string>>(
    () => new Set(events.map(request).filter((id): id is string => !!id)),
  )
  const lastDraft = useRef(draft),
    lastTyped = useRef(0)
  useEffect(() => {
    if (lastDraft.current !== draft) {
      lastDraft.current = draft
      lastTyped.current = Date.now()
    }
    const reveal = () =>
      setAllowed((previous) => {
        const next = new Set(events.map(request).filter((id): id is string => !!id))
        return previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next
      })
    const remaining = 1000 - (Date.now() - lastTyped.current)
    if (remaining <= 0) {
      reveal()
      return
    }
    const timer = setTimeout(reveal, remaining)
    return () => clearTimeout(timer)
  }, [events, draft])
  return useMemo(
    () =>
      events.filter((event) => {
        const id = request(event)
        return !id || allowed.has(id)
      }),
    [events, allowed],
  )
}
