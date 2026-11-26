import { expect, it } from 'vitest'
import type { AgentEvent, ChatGoal } from '@ramu/shared/types'
import { completedGoalsByTurn } from '../src/views/agent/lib/derive'

const goal = (id: string, at: number): ChatGoal =>
  ({ id, objective: `Goal ${id}`, status: 'completed', turns: 2, reason: 'Done', updatedAt: at }) as ChatGoal

it('shows a goal in the turn it finished in, even after a steered message or in a continuation with no message', () => {
  const events = [
    { kind: 'user', text: 'Build it', at: 100 },
    { kind: 'user', text: 'also the phone', steered: true, at: 150 },
    { kind: 'goal', goal: goal('a', 200), at: 200 },
    { kind: 'goal', goal: goal('a', 210), at: 210 },
    { kind: 'goal', goal: goal('b', 900), at: 900 },
  ] as AgentEvent[]
  // Turn 0 started with "Build it"; the steer joined it. Turn 5 is a continuation that no message started.
  const turns = [
    { key: 0, startedAt: 100 },
    { key: 5, startedAt: 800 },
  ]
  const byTurn = completedGoalsByTurn(events, turns)
  expect(byTurn.get(0)?.map((entry) => entry.id)).toEqual(['a'])
  expect(byTurn.get(5)?.map((entry) => entry.id)).toEqual(['b'])
})
