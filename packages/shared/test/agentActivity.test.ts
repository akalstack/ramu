import { describe, expect, it } from 'vitest'
import { agentActivityLabel, turnStartedAt, turnSteps } from '../src/chat/agentActivity'
import { awaitedCommands, holdsTurn, turnWorkEnd } from '../src/chat/helperPresentation'
import type { AgentEvent } from '../src/types'

describe('agent activity labels', () => {
  it('says only starting or working, whatever the agent is streaming', () => {
    expect(agentActivityLabel('starting')).toBe('Starting…')
    expect(agentActivityLabel('running')).toBe('Working')
    for (const state of ['idle', 'stopped', 'failed', 'needs-input', undefined] as const)
      expect(agentActivityLabel(state)).toBeNull()
  })
})

describe('turnSteps', () => {
  it('lists the main agent’s actions since the last message, finished or running, newest last', () => {
    const events: AgentEvent[] = [
      { kind: 'tool-use', toolUseId: 'old', name: 'Bash', summary: 'ls' },
      { kind: 'user', text: 'Run the tests' },
      { kind: 'tool-use', toolUseId: 'a', name: 'Read', summary: 'src/app.ts' },
      { kind: 'tool-result', toolUseId: 'a', isError: false, summary: '' },
      { kind: 'tool-use', toolUseId: 'helper', name: 'Bash', summary: 'echo', agentId: 'h1' } as AgentEvent,
      { kind: 'tool-use', toolUseId: 'b', name: 'Bash', summary: 'pnpm test\nmore' },
    ]
    const steps = turnSteps(events)
    expect(steps.map((step) => [step.done, step.detail])).toEqual([
      [true, 'src/app.ts'],
      [false, 'pnpm test'],
    ])
    expect(turnSteps(events, 1).map((step) => step.detail)).toEqual(['pnpm test'])
  })
})

describe('the running turn clock', () => {
  const done: AgentEvent = { kind: 'result', isError: false, text: 'Done.', costUsd: null, at: 5000 }
  const asked: AgentEvent = { kind: 'user', text: 'go', at: 1000 }
  const said: AgentEvent = { kind: 'text', text: 'working', at: 2000 }

  it('starts at the message that opened the turn and runs through a message steered into it', () => {
    expect(turnStartedAt([asked, said])).toBe(1000)
    expect(turnStartedAt([asked, said, { kind: 'user', text: 'also tests', steered: true, at: 3000 }, said])).toBe(1000)
    expect(turnStartedAt([])).toBeNull()
  })

  it('stays on the turn a result closed until the agent shows new work, so waiting on sub-agents keeps one clock', () => {
    expect(turnStartedAt([asked, said, done])).toBe(1000)
    expect(turnStartedAt([asked, said, done, { kind: 'thinking', text: 'helper', agentId: 'helper', at: 6000 }])).toBe(
      1000,
    )
    expect(
      turnStartedAt([
        asked,
        said,
        done,
        { kind: 'init', provider: 'claude-code', model: 'm', cwd: '/', providerSessionId: 's', at: 7000 },
      ]),
    ).toBe(1000)
  })

  it('starts work the agent picked up by itself where it resumed, not at the last message', () => {
    const resumed: AgentEvent[] = [
      asked,
      said,
      done,
      { kind: 'thinking', text: 'The checks finished', at: 90_000 },
      { kind: 'text', text: 'They passed.', at: 95_000 },
    ]
    expect(turnStartedAt(resumed)).toBe(90_000)
    // Its own result does not move the clock back to the first turn while sub-agents finish under it.
    expect(turnStartedAt([...resumed, { ...done, at: 99_000 }])).toBe(90_000)
  })

  it('starts the work done for a message steered in too late with that message', () => {
    const late: AgentEvent = { kind: 'user', text: 'fix the header', steered: true, at: 3000 }
    const fixing: AgentEvent = { kind: 'text', text: 'Fixing the header.', at: 8000 }
    expect(turnStartedAt([asked, late, said, done, fixing])).toBe(3000)
    // A call ran after the steer, so the answer saw it and the later work is the agent's own.
    const call: AgentEvent = { kind: 'tool-use', toolUseId: 'a', name: 'Bash', summary: 'ls', at: 3500 }
    expect(turnStartedAt([asked, late, call, said, done, fixing])).toBe(8000)
  })

  it('ends a turn with the last sub-agent it waited on, within the turn after it', () => {
    const helper = { agentId: 'a', name: 'A', status: 'completed' as const, startedAt: 2000, endedAt: 60_000 }
    expect(turnWorkEnd(5000, [])).toBe(5000)
    expect(turnWorkEnd(5000, [helper])).toBe(60_000)
    expect(turnWorkEnd(5000, [{ ...helper, endedAt: undefined, durationMs: 30_000 }])).toBe(32_000)
    expect(turnWorkEnd(5000, [helper], 20_000)).toBe(20_000)
    expect(turnWorkEnd(5000, [helper], 4000)).toBe(5000)
    expect(turnWorkEnd(5000, [{ ...helper, taskType: 'local_bash' }])).toBe(5000)
    expect(turnWorkEnd(5000, [{ ...helper, taskType: 'advisor' }])).toBe(5000)
    expect(turnWorkEnd(5000, [{ ...helper, resumedAt: 50_000 }])).toBe(5000)
    expect(turnWorkEnd(undefined, [helper])).toBeUndefined()
  })

  it('ends a turn with a background command the agent waited on, but not one left running beside it', () => {
    const command = {
      agentId: 'c',
      name: 'pnpm test',
      taskType: 'local_bash',
      status: 'completed' as const,
      startedAt: 2000,
      endedAt: 60_000,
    }
    expect(turnWorkEnd(5000, [command])).toBe(5000)
    expect(turnWorkEnd(5000, [{ ...command, awaited: true }])).toBe(60_000)
    expect(turnWorkEnd(5000, [{ ...command, awaited: true }], 20_000)).toBe(20_000)
    expect(turnWorkEnd(5000, [{ ...command, awaited: true, status: 'running', endedAt: undefined }])).toBe(5000)
  })

  it('counts a running sub-agent as holding the thread, but not a background command, an advisor or a recovered one', () => {
    const helper = { agentId: 'a', name: 'A', status: 'running' as const }
    expect(holdsTurn(helper)).toBe(true)
    expect(holdsTurn({ ...helper, status: 'completed' })).toBe(false)
    expect(holdsTurn({ ...helper, taskType: 'local_bash' })).toBe(false)
    expect(holdsTurn({ ...helper, taskType: 'advisor' })).toBe(false)
    expect(holdsTurn({ ...helper, recovered: true })).toBe(false)
  })

  it('counts a background command as holding the thread only while it runs and the agent is waiting on it', () => {
    const command = { agentId: 'c', name: 'pnpm test', taskType: 'local_bash', status: 'running' as const }
    expect(holdsTurn(command)).toBe(false)
    expect(holdsTurn({ ...command, awaited: true })).toBe(true)
    expect(holdsTurn({ ...command, awaited: true, status: 'completed' })).toBe(false)
    expect(holdsTurn({ ...command, awaited: true, status: 'stopped' })).toBe(false)
    expect(holdsTurn({ ...command, awaited: true, recovered: true })).toBe(false)
    expect(holdsTurn({ ...command, taskType: 'advisor', awaited: true })).toBe(false)
    const events: AgentEvent[] = [
      { kind: 'agent', ...command, agentId: 'server', name: 'pnpm dev' },
      { kind: 'agent', ...command, awaited: true },
      { kind: 'agent', ...command, agentId: 'done', awaited: true, status: 'completed' },
    ]
    expect(awaitedCommands(events).map((task) => task.agentId)).toEqual(['c', 'done'])
  })
})
