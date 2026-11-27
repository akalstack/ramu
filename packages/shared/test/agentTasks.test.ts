import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentTask } from '../src/types'
import { helperConversation, isStaleProgress, latestTasks, taskMessagePrompt } from '../src/chat/agentTasks'

describe('isStaleProgress', () => {
  it('rejects running progress after a helper ended, unless it resumed later', () => {
    const ended = { status: 'stopped' as const, endedAt: 100 }
    expect(isStaleProgress(ended, { status: 'running' })).toBe(true)
    expect(isStaleProgress(ended, { status: 'running', resumedAt: 100 })).toBe(true)
    expect(isStaleProgress(ended, { status: 'running', resumedAt: 101 })).toBe(false)
  })

  it('accepts everything else', () => {
    expect(isStaleProgress(undefined, { status: 'running' })).toBe(false)
    expect(isStaleProgress({ status: 'running' }, { status: 'running' })).toBe(false)
    expect(isStaleProgress({ status: 'stopped', endedAt: 5 }, { status: 'failed' })).toBe(false)
  })

  it('keeps a stopped helper stopped in the transcript fold', () => {
    const events = [
      { kind: 'agent', agentId: 'a', name: 'A', status: 'running' },
      { kind: 'agent', agentId: 'a', name: 'A', status: 'stopped', endedAt: 10 },
      { kind: 'agent', agentId: 'a', name: 'Late', status: 'running' },
    ] as never
    expect(latestTasks(events).map((task) => task.status)).toEqual(['stopped'])
  })
})

describe('helperConversation', () => {
  const task = { agentId: 'a1', address: 'scout', name: 'Scout', status: 'running' } as AgentTask
  it('keeps the helper’s own events and what was relayed to it, without its agent id', () => {
    const events = [
      { kind: 'user', text: 'main question' },
      { kind: 'agent', ...task },
      { kind: 'text', text: 'helper thought', agentId: 'a1' },
      { kind: 'text', text: 'other helper', agentId: 'a2' },
      { kind: 'user', text: taskMessagePrompt('claude-code', task, 'look at tests') },
      { kind: 'text', text: 'main answer' },
    ] as AgentEvent[]
    expect(helperConversation(events, task)).toEqual([
      { kind: 'text', text: 'helper thought' },
      { kind: 'user', text: 'look at tests' },
    ])
  })
  it('gives a background command the call that started it', () => {
    const call = { kind: 'tool-use', toolUseId: 't1', name: 'Bash', input: {} } as AgentEvent
    const events = [call, { kind: 'tool-use', toolUseId: 't2', name: 'Bash', input: {} } as AgentEvent]
    expect(helperConversation(events, { agentId: 'b', taskType: 'local_bash', toolUseId: 't1' })).toEqual([call])
  })
})
