import { expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { latestTasks } from '@ramu/shared/chat/agentTasks'
import { holdsTurn } from '@ramu/shared/chat/helperPresentation'
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

it('puts a message steered in too late for its turn at the head of the work done for it', () => {
  const events: AgentEvent[] = [
    { kind: 'user', text: 'where do things stand?', at: 1000 },
    { kind: 'user', text: 'fix the header', steered: true, at: 2000 },
    { kind: 'text', text: 'Everything is in place.', at: 3000 },
    result('Everything is in place.'),
    { kind: 'text', text: 'Fixing the header.', at: 5000 },
    result('Fixed.'),
  ]
  const turns = toTurns(
    events.map((event) => ({ kind: 'event' as const, event })),
    events,
  )
  const said = (block: (typeof turns)[number]['user']) =>
    block?.kind === 'event' && block.event.kind === 'user' ? block.event.text : null
  expect(turns.map((turn) => said(turn.user))).toEqual(['where do things stand?', 'fix the header'])
  expect(turns[0]!.items.some((block) => said(block) !== null)).toBe(false)
  expect(turns[1]!.startedAt).toBe(2000)
})

const agent = (agentId: string, patch: Partial<Extract<AgentEvent, { kind: 'agent' }>>): AgentEvent => ({
  kind: 'agent',
  agentId,
  name: agentId,
  status: 'completed',
  ...patch,
})

it('marks work the agent picked up by itself as continuing the turn above, timed from its first step', () => {
  const events: AgentEvent[] = [
    { kind: 'user', text: 'run the checks in the background', at: 1000 },
    { kind: 'text', text: 'Started them.', at: 2000 },
    { ...result('Started them.'), at: 3000 },
    { kind: 'init', provider: 'claude-code', model: 'm', cwd: '/', providerSessionId: 's', at: 9000 },
    { kind: 'tool-use', toolUseId: 'read', name: 'Read', summary: 'log', at: 10_000 },
    { kind: 'text', text: 'They passed.', at: 12_000 },
    { ...result('They passed.'), at: 13_000 },
  ]
  const turns = toTurns(
    [
      { kind: 'event', event: events[0]! },
      { kind: 'event', event: events[1]! },
      { kind: 'event', event: events[2]! },
      { kind: 'tools', tools: [events[4] as Extract<AgentEvent, { kind: 'tool-use' }>] },
      { kind: 'event', event: events[5]! },
      { kind: 'event', event: events[6]! },
    ],
    events,
  )
  // Work picked up after a clean result is a turn of its own, with its own time.
  expect(turns.map(({ startedAt, endedAt }) => ({ startedAt, endedAt }))).toEqual([
    { startedAt: 1000, endedAt: 3000 },
    { startedAt: 10_000, endedAt: 13_000 },
  ])
})

it('ends a turn when the sub-agents it started were done, never past the turn after it', () => {
  const events: AgentEvent[] = [
    { kind: 'user', text: 'review this', at: 1000 },
    agent('reviewer', { startedAt: 2000, endedAt: 60_000 }),
    agent('server', { taskType: 'local_bash', startedAt: 2000, endedAt: 900_000 }),
    { kind: 'text', text: 'The reviewer is on it.', at: 3000 },
    { ...result('The reviewer is on it.'), at: 4000 },
  ]
  const ended = (list: AgentEvent[]) =>
    toTurns(
      list.map((event) => ({ kind: 'event' as const, event })),
      list,
    )[0]!.endedAt
  expect(ended(events)).toBe(60_000)
  expect(ended([...events, { kind: 'user', text: 'never mind', at: 20_000 }])).toBe(20_000)
  // One still running has no end yet: the turn row counts live instead.
  expect(
    ended(events.map((event) => (event.kind === 'agent' ? { ...event, status: 'running' as const } : event))),
  ).toBe(4000)
})

it('keeps the last turn at work while a command the agent waits on runs, and ends it when the command does', () => {
  const command = { taskType: 'local_bash', background: true, startedAt: 2000 }
  const events = (patch: Partial<Extract<AgentEvent, { kind: 'agent' }>>): AgentEvent[] => [
    { kind: 'user', text: 'run the tests', at: 1000 },
    agent('tests', { ...command, ...patch }),
    agent('server', { ...command, status: 'running' }),
    { kind: 'text', text: 'They are running.', at: 3000 },
    { ...result('They are running.'), at: 4000 },
  ]
  const turn = (list: AgentEvent[]) =>
    toTurns(
      list.flatMap((event) => (event.kind === 'agent' ? [] : [{ kind: 'event' as const, event }])),
      list,
    )[0]!
  // The thread view counts the turn live while any task holds it.
  const held = (list: AgentEvent[]) => latestTasks(list).some(holdsTurn)
  const waiting = events({ status: 'running', awaited: true })
  expect(held(waiting)).toBe(true)
  expect(turn(waiting).endedAt).toBe(4000)
  const done = events({ status: 'completed', awaited: true, endedAt: 60_000 })
  expect(held(done)).toBe(false)
  expect(turn(done).endedAt).toBe(60_000)
  // A command the agent never said it was waiting on runs beside the turn.
  expect(held(events({ status: 'running' }))).toBe(false)
  expect(turn(events({ status: 'completed', endedAt: 60_000 })).endedAt).toBe(4000)
})
