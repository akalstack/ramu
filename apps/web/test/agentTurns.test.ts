import { expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { toTurns, turnParts } from '../src/views/agent/lib/turns'

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

it('opens a new turn when the agent works again after a result, such as a goal continuing on its own', () => {
  expect(
    turnsOf([
      { kind: 'user', text: 'where do things stand?' },
      { kind: 'text', text: 'The project is clean.' },
      result('The project is clean.'),
      { kind: 'thinking', text: 'Resuming the goal' },
      { kind: 'text', text: 'Building the hero next.' },
    ]),
  ).toEqual([
    { ended: true, interrupted: false },
    { ended: false, interrupted: false },
  ])
})

it('keeps a steered message inside its turn, with one start, and splits the turn into parts at it', () => {
  const events: AgentEvent[] = [
    { kind: 'user', text: 'go', at: 1000 },
    { kind: 'text', text: 'working', at: 2000 },
    { kind: 'user', text: 'also add tests', steered: true, at: 3000 },
    { kind: 'text', text: 'adding tests', at: 4000 },
    result('Done.'),
  ]
  const turns = toTurns(
    events.map((event) => ({ kind: 'event' as const, event })),
    events,
  )
  expect(turns).toHaveLength(1)
  expect(turns[0]!.startedAt).toBe(1000)
  const parts = turnParts(turns[0]!.items)
  expect(
    parts.map((part) =>
      part.steer?.kind === 'event' && part.steer.event.kind === 'user' ? part.steer.event.text : null,
    ),
  ).toEqual([null, 'also add tests'])
  expect(parts.map((part) => part.items.length)).toEqual([1, 2])
})
