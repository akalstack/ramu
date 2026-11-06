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

it('gives a message to a teammate its own turn, so the lead’s answer above it stays the answer', () => {
  const events: AgentEvent[] = [
    { kind: 'user', text: 'add a reset flow' },
    { kind: 'text', text: 'Added it.' },
    result('Added it.'),
    { kind: 'teammate-message', teammateId: 'mate', name: 'Opus 5.5', text: 'Review the reset flow' },
    { kind: 'agent', agentId: 'mate', name: 'Opus 5.5', teammate: 'review', status: 'running' },
  ]
  const turns = toTurns(
    events.map((event) => ({ kind: 'event' as const, event })),
    events,
  )
  expect(turns.map((turn) => turn.user?.kind === 'event' && turn.user.event.kind)).toEqual(['user', 'teammate-message'])
  expect(turns[0]!.items.map((block) => block.kind === 'event' && block.event.kind)).toEqual(['text', 'result'])
  // Only the teammate works on it, so there is no lead turn left running.
  expect(turns[1]).toMatchObject({ ended: true })
})

it('keeps the lead’s turn open after a message to a teammate when the lead is still working', () => {
  expect(
    turnsOf([
      { kind: 'user', text: 'go' },
      { kind: 'teammate-message', teammateId: 'mate', name: 'Opus 5.5', text: 'Review as it goes' },
      { kind: 'text', text: 'still working' },
    ]).at(-1),
  ).toEqual({ ended: false, interrupted: false })
})
