import { expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { toTurns } from '../src/views/agent/lib/turns'

const turnsOf = (events: AgentEvent[]) =>
  toTurns(
    events.map((event) => ({ kind: 'event' as const, event })),
    events,
  ).map(({ ended, interrupted }) => ({ ended, interrupted: !!interrupted }))
const result = (text: string, isError = false): AgentEvent => ({ kind: 'result', isError, text, costUsd: null })

it('reads a turn as stopped from the provider’s status, never from words in the answer', () => {
  expect(
    turnsOf([{ kind: 'user', text: 'go' }, result('Added an AbortController so a run can be interrupted.')]),
  ).toEqual([{ ended: true, interrupted: false }])
  for (const status of ['interrupted', 'cancelled', '[Request interrupted by user]'])
    expect(turnsOf([{ kind: 'user', text: 'go' }, result(status)])).toEqual([{ ended: true, interrupted: true }])
  expect(turnsOf([{ kind: 'user', text: 'go' }, result('error_during_execution', true)])).toEqual([
    { ended: true, interrupted: true },
  ])
})

it('treats a turn the agent carried on from, after a steered message, as finished rather than stopped', () => {
  expect(
    turnsOf([
      { kind: 'user', text: 'go' },
      { kind: 'text', text: 'working' },
      { kind: 'user', text: 'also add tests' },
      result('Done.'),
    ]),
  ).toEqual([
    { ended: true, interrupted: false },
    { ended: true, interrupted: false },
  ])
  expect(
    turnsOf([
      { kind: 'user', text: 'go' },
      { kind: 'state', state: 'stopped', at: 2 },
      { kind: 'user', text: 'continue' },
      result('Done.'),
    ])[0],
  ).toEqual({ ended: false, interrupted: false })
})
