import { expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { heldTranscript, holdTranscript, lastSeqOf } from '../src/views/agent/lib/heldTranscripts'

const rows = new Map<number, { event: AgentEvent }>([[7, { event: { kind: 'user', text: 'hi' } }]])

it('keeps a transcript per host with its cursor, dropping the least recently held', () => {
  holdTranscript('studio', 's', { rows, cursor: 9 })
  expect(heldTranscript('studio', 's')?.cursor).toBe(9)
  expect(heldTranscript('laptop', 's')).toBeUndefined()
  for (let index = 0; index < 24; index++) holdTranscript('studio', `other-${index}`, { rows, cursor: 1 })
  expect(heldTranscript('studio', 's')).toBeUndefined()
  expect(heldTranscript('studio', 'other-23')?.cursor).toBe(1)
})

it('reads the last sequence from the host numbers, which may have gaps', () => {
  expect(
    lastSeqOf(
      new Map([
        [3, 0],
        [40, 0],
        [9, 0],
      ]),
    ),
  ).toBe(40)
  expect(lastSeqOf(new Map())).toBe(0)
})
