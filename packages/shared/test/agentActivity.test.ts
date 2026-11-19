import { describe, expect, it } from 'vitest'
import { agentActivityLabel, turnSteps } from '../src/chat/agentActivity'
import type { AgentEvent } from '../src/types'

const thought: AgentEvent = { kind: 'thinking', text: 'Considering the request' }
const user: AgentEvent = { kind: 'user', text: 'Try again' }

describe('agent activity labels', () => {
  it('uses startup and general work labels before reasoning arrives', () => {
    expect(agentActivityLabel('starting', [thought, user])).toBe('Starting…')
    expect(agentActivityLabel('running', [])).toBe('Working')
    expect(agentActivityLabel('running', [thought, user])).toBe('Working')
  })

  it('follows reasoning, tools, and response text as activity changes', () => {
    const tool: AgentEvent = { kind: 'tool-use', toolUseId: 'command', name: 'Bash', summary: 'pwd' }
    const result: AgentEvent = { kind: 'tool-result', toolUseId: 'command', isError: false, summary: '/project' }
    expect(agentActivityLabel('running', [user, thought])).toBe('Thinking')
    expect(agentActivityLabel('running', [user, thought, tool])).toBe('Working')
    expect(agentActivityLabel('running', [user, thought, tool, result])).toBe('Working')
    expect(agentActivityLabel('running', [user, tool, result, thought])).toBe('Thinking')
    expect(agentActivityLabel('running', [user, thought, { kind: 'text', text: 'Here is the answer' }])).toBe(
      'Writing…',
    )
  })

  it('ignores helper reasoning and bookkeeping events', () => {
    expect(agentActivityLabel('running', [user, { ...thought, agentId: 'helper' }])).toBe('Working')
    expect(agentActivityLabel('running', [user, thought, { kind: 'context', used: 10, max: 100 }])).toBe('Thinking')
    expect(agentActivityLabel('running', [user, { kind: 'thinking', text: ' ' }])).toBe('Working')
  })

  it('does not carry reasoning past a completed turn or inactive session', () => {
    expect(
      agentActivityLabel('running', [thought, { kind: 'result', isError: false, text: 'Done', costUsd: null }]),
    ).toBe('Working')
    for (const state of ['idle', 'stopped', 'failed', 'needs-input', undefined] as const) {
      expect(agentActivityLabel(state, [thought])).toBeNull()
    }
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
