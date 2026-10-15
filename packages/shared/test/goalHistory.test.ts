import { expect, it } from 'vitest'
import { goalChanges } from '../src/chat/goalHistory'
import type { AgentEvent, ChatGoal } from '../src/types'

const goal = (patch: Partial<ChatGoal> = {}): ChatGoal => ({
  id: 'g1',
  objective: 'Ship it',
  status: 'active',
  turns: 0,
  reason: '',
  updatedAt: 1,
  ...patch,
})
const event = (value: ChatGoal | null): AgentEvent => ({ kind: 'goal', goal: value })

it('keeps only the turning points of a goal', () => {
  const events = [
    event(goal()),
    event(goal({ turns: 1 })),
    event(goal({ status: 'waiting-provider' })),
    event(goal({ status: 'active' })),
    event(goal({ status: 'paused' })),
    event(goal({ status: 'active' })),
    event(goal({ status: 'blocked', reason: 'Needs a key' })),
    event(goal({ status: 'completed' })),
  ]
  expect([...goalChanges(events).values()].map((change) => change.type)).toEqual([
    'set',
    'paused',
    'resumed',
    'blocked',
  ])
})

it('tells a new goal, an edit and a clear apart, and leaves completion to its own row', () => {
  const edited = event(goal({ objective: 'Ship it faster' })),
    next = event(goal({ id: 'g2', objective: 'Another' })),
    cleared = event(null)
  const changes = goalChanges([
    event(goal()),
    edited,
    event(goal({ objective: 'Ship it faster', status: 'completed' })),
    next,
    cleared,
  ])
  expect([...changes.values()].map((change) => change.type)).toEqual(['set', 'edited', 'set', 'cleared'])
  expect(changes.get(cleared)?.goal.id).toBe('g2')
  expect(goalChanges([event(goal({ status: 'completed' })), event(null)]).size).toBe(0)
})
