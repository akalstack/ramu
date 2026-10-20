import { useRef } from 'react'
import type { AgentEvent } from '@ramu/shared/types'
import { transcriptArrivals } from '../lib/transcriptArrival'

export function useTranscriptArrival(sequences: Map<AgentEvent, number>, hydrating: boolean) {
  const arrivals = useRef<ReturnType<typeof transcriptArrivals> | null>(null)
  arrivals.current ??= transcriptArrivals()
  arrivals.current.sync(sequences.values(), hydrating)
  return (event: AgentEvent) => event.kind !== 'user' && arrivals.current!.claim(sequences.get(event))
}
