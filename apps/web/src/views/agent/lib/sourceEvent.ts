import type { AgentEvent } from '@ramu/shared/types'

/** Sequence IDs survive snapshot gaps; request links select the latest reuse of that exact ID. */
export function sourceEvent(
  events: AgentEvent[],
  sequences: Map<AgentEvent, number>,
  target: { sourceSeq?: number; focusRequestId?: string },
): AgentEvent | undefined {
  if (target.focusRequestId)
    return events.findLast(
      (event) =>
        'requestId' in event &&
        event.requestId === target.focusRequestId &&
        ['question', 'permission-request', 'elicitation'].includes(event.kind),
    )
  return target.sourceSeq === undefined ? undefined : events.find((event) => sequences.get(event) === target.sourceSeq)
}
