import { expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { sourceEvent } from '../src/views/agent/lib/sourceEvent'

it('uses recorded sequence IDs across gaps and replaces rewound event objects', () => {
  const first: AgentEvent = { kind: 'text', text: 'first' }
  const last: AgentEvent = { kind: 'text', text: 'last' }
  const sequences = new Map([
    [first, 4],
    [last, 9],
  ])
  expect(sourceEvent([first, last], sequences, { sourceSeq: 9 })).toBe(last)
  expect(sourceEvent([first, last], sequences, { sourceSeq: 2 })).toBeUndefined()
  expect(sourceEvent([first], new Map([[first, 4]]), { sourceSeq: 9 })).toBeUndefined()
})
it('targets the latest exact request ID and ignores its resolution and unrelated requests', () => {
  const old: AgentEvent = { kind: 'permission-request', requestId: 'same', toolName: 'Bash', title: 'old', detail: '' }
  const current: AgentEvent = { ...old, title: 'current' }
  const events: AgentEvent[] = [
    old,
    { kind: 'request-resolved', requestId: 'same', outcome: 'allowed' },
    current,
    { ...old, requestId: 'other' },
  ]
  expect(sourceEvent(events, new Map(), { focusRequestId: 'same' })).toBe(current)
  expect(sourceEvent(events, new Map(), { focusRequestId: 'missing' })).toBeUndefined()
})
