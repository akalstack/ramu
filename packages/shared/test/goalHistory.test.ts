import { expect, it } from 'vitest'
import {
  checkHow,
  checkOutcome,
  checkTail,
  goalChanges,
  goalFactLines,
  goalFacts,
  isStallBlock,
} from '../src/chat/goalHistory'
import type { AgentEvent, ChatGoal, GoalCheck } from '../src/types'

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
const work: AgentEvent = { kind: 'text', text: 'Working on it' }

it('keeps only the turning points of a goal', () => {
  const events = [
    event(goal()),
    event(goal({ turns: 1 })),
    event(goal({ status: 'paused', pausedBy: 'provider-limit' })),
    event(goal({ status: 'active' })),
    event(goal({ status: 'paused' })),
    event(goal({ status: 'active', updatedAt: 600_000 })),
    work,
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
    work,
    edited,
    event(goal({ objective: 'Ship it faster', status: 'completed' })),
    next,
    cleared,
  ])
  expect([...changes.values()].map((change) => change.type)).toEqual(['set', 'edited', 'set', 'cleared'])
  expect(changes.get(cleared)?.goal.id).toBe('g2')
  expect(goalChanges([event(goal({ status: 'completed' })), event(null)]).size).toBe(0)
})

it('drops a pause the person undid moments later, before the agent did anything', () => {
  const changes = goalChanges([
    event(goal()),
    work,
    event(goal({ status: 'paused' })),
    event(goal({ status: 'active' })),
    event(goal({ status: 'paused' })),
  ])
  expect([...changes.values()].map((change) => change.type)).toEqual(['set', 'paused'])
  // The agent's own sub-agents working meanwhile do not make the pause stand.
  const helper: AgentEvent = { kind: 'text', text: 'Reading', agentId: 'helper' }
  expect(
    [
      ...goalChanges([
        event(goal()),
        work,
        event(goal({ status: 'paused' })),
        helper,
        event(goal({ status: 'active' })),
      ]).values(),
    ].map((change) => change.type),
  ).toEqual(['set'])
})

it('reads a goal set and reworded before any work as set, at its final wording', () => {
  const last = event(goal({ objective: 'Ship it today' }))
  const changes = goalChanges([event(goal()), event(goal({ objective: 'Ship it soon' })), last, work])
  expect([...changes.entries()]).toEqual([[last, { type: 'set', goal: goal({ objective: 'Ship it today' }) }]])
})

const failedCheck = (patch: Partial<GoalCheck> = {}): GoalCheck => ({
  command: 'pnpm test',
  ok: false,
  code: 1,
  output: 'Command exited with code 1.\nFAIL login.test.ts\nexpected 200, got 500',
  at: 10,
  ...patch,
})

it('draws a row for each failed verification, once, and not for the same result delivered to the agent', () => {
  const failed = goal({ check: failedCheck() })
  const events = [
    event(goal()),
    event(failed),
    event({ ...failed, check: { ...failed.check!, delivered: true }, turns: 1 }),
    event(goal({ turns: 1, check: failedCheck({ at: 20, code: 2 }) })),
    event(goal({ status: 'completed', check: { ...failedCheck({ at: 30 }), ok: true, code: 0 } })),
  ]
  const changes = [...goalChanges(events).values()]
  expect(changes.map((change) => change.type)).toEqual(['set', 'verify-failed', 'verify-failed'])
  expect(changes[2]!.goal.check?.code).toBe(2)
})

it('tells a stall block from a block the agent asked for, and keeps usage limits and pauses out of both', () => {
  const stall = { fingerprint: 'f', unchanged: 2, seq: 9 }
  const stalled = goal({ status: 'blocked', reason: 'No progress: the last 2 continuations changed no files.', stall })
  const asked = goal({
    status: 'blocked',
    reason: 'No progress is possible without the API key',
    stall: { ...stall, unchanged: 0 },
  })
  expect(isStallBlock(stalled)).toBe(true)
  expect(isStallBlock(asked)).toBe(false)
  const types = (...goals: ChatGoal[]) => [...goalChanges(goals.map(event)).values()].map((change) => change.type)
  expect(types(goal(), stalled)).toEqual(['set', 'stalled'])
  expect(types(goal(), asked)).toEqual(['set', 'blocked'])
  expect(types(goal(), goal({ status: 'paused', pausedBy: 'provider-limit' }), goal({ status: 'paused' }))).toEqual([
    'set',
    'paused',
  ])
})

it('keeps a limit hold out of the history in its merged shape, and still shows a user pause that follows it', () => {
  const hold = goal({ status: 'paused', pausedBy: 'provider-limit' })
  const types = (...goals: ChatGoal[]) => [...goalChanges(goals.map(event)).values()].map((change) => change.type)
  // Held at a limit and continued: no paused row and no resumed row.
  expect(types(goal(), hold, goal())).toEqual(['set'])
  // Same status, different holder: the user pausing a held goal is a turning point.
  expect(types(goal(), hold, goal({ status: 'paused', pausedBy: 'user' }))).toEqual(['set', 'paused'])
  // The user resuming their own pause is shown; a user pause with no reason still counts.
  expect(types(goal(), goal({ status: 'paused' }), goal({ updatedAt: 600_000 }))).toEqual(['set', 'paused', 'resumed'])
  // A limit hold followed by another hold adds no row either way.
  expect(types(goal(), goal({ status: 'paused', pausedBy: 'provider-limit' }), hold)).toEqual(['set'])
})

it('describes how a check ended and trims its output to the tail', () => {
  expect(checkOutcome(failedCheck())).toEqual({ kind: 'exit', code: 1 })
  expect(checkHow(failedCheck())).toBe('Exit 1')
  expect(checkHow(failedCheck({ code: null, timedOut: true }))).toBe('Timed out')
  expect(checkHow(failedCheck({ code: null }))).toBe('Could not run')
  expect(checkHow(failedCheck({ ok: true, code: 0 }))).toBe('Passed')
  expect(checkTail(failedCheck())).toBe('FAIL login.test.ts\nexpected 200, got 500')
  const long = failedCheck({ output: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') })
  expect(checkTail(long, 3)).toBe('line 37\nline 38\nline 39')
  expect(checkTail(failedCheck({ output: 'x'.repeat(5000) }), 12, 100).length).toBeLessThanOrEqual(101)
})

it('collects the verification command, its result and the completion evidence', () => {
  const done = goal({
    status: 'completed',
    verify: 'pnpm test',
    check: { ...failedCheck(), ok: true, code: 0, output: 'ok' },
    evidence: {
      checks: [{ name: 'pnpm test', passed: true, output: 'ok' }],
      changedFiles: ['src/login.ts', 'test/login.test.ts'],
    },
  })
  expect(goalFacts(done)).toMatchObject({
    verify: 'pnpm test',
    check: { ok: true, how: 'Passed', tail: '' },
    evidence: { checks: [{ name: 'pnpm test', passed: true }], changedFiles: ['src/login.ts', 'test/login.test.ts'] },
  })
  expect(goalFactLines(done)).toEqual([
    'Verified: pnpm test',
    'Checks: pnpm test (passed)',
    'Changed: src/login.ts, test/login.test.ts',
  ])
  expect(goalFactLines(goal({ check: failedCheck() }))).toEqual([
    'pnpm test · Exit 1',
    'FAIL login.test.ts\nexpected 200, got 500',
  ])
  expect(goalFacts(goal())).toEqual({})
})
