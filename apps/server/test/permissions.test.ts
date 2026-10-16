import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type AgentSettings, type AgentSessionState } from '@ramu/shared/types'
import { createCanUseTool } from '../src/agent/permissions'
import type { PendingRequest } from '../src/agent/types'

function fixture(access: AgentSettings['access'], restricted = false) {
  const pending = new Map<string, PendingRequest>()
  const events: AgentEvent[] = []
  const states: AgentSessionState[] = []
  const canUseTool = createCanUseTool({
    settings: { ...DEFAULT_AGENT_SETTINGS, access },
    pending,
    record: (event) => events.push(event),
    setState: (state) => states.push(state),
    restricted,
  })
  const call = (name: string, input: Record<string, unknown> = {}) =>
    canUseTool(name, input, { signal: new AbortController().signal, toolUseID: name, requestId: name })
  return { pending, events, states, call }
}

it('Auto permits direct and discovered Ramu tools without interrupting the turn', async () => {
  const { call, pending, events, states } = fixture('auto')
  for (const [tool, input] of [
    ['tool_invoke', { name: 'memory_search', arguments: { query: 'project' } }],
    ['ramu_agent', { prompt: 'Review the changes' }],
    ['schedule_create', { prompt: 'Review tomorrow' }],
    ['memory_save', { content: 'Use pnpm' }],
    ['ask_user', { questions: [] }],
  ] as const) {
    expect(await call(`mcp__ramu__${tool}`, input)).toEqual({ behavior: 'allow', updatedInput: input })
  }
  expect(pending.size).toBe(0)
  expect(events).toEqual([])
  expect(states).toEqual([])
})

it.each(['auto', 'edits'] as const)('%s still asks for commands and tools from other MCP servers', async (access) => {
  for (const name of ['Bash', 'mcp__external__tool_invoke', 'mcp__ramu_other__memory_save']) {
    const { call, pending, events, states } = fixture(access)
    const result = call(name, { command: 'do something' })
    expect(events).toEqual([expect.objectContaining({ kind: 'permission-request', toolName: name })])
    expect(states).toEqual(['needs-input'])
    const request = [...pending.values()][0]!
    request.resolve({ behavior: 'deny', message: 'Declined' })
    expect(await result).toMatchObject({ behavior: 'deny' })
  }
})

it('Allow edits keeps approval for Ramu mutations, and Full access permits them', async () => {
  const edits = fixture('edits')
  const result = edits.call('mcp__ramu__tool_invoke', { name: 'schedule_create', arguments: {} })
  expect(edits.events).toEqual([expect.objectContaining({ kind: 'permission-request' })])
  ;[...edits.pending.values()][0]!.resolve({ behavior: 'deny', message: 'Declined' })
  expect(await result).toMatchObject({ behavior: 'deny' })
  expect(await fixture('full').call('mcp__ramu__tool_invoke')).toMatchObject({ behavior: 'allow' })
})

it('Auto keeps native questions as questions rather than approving them', async () => {
  const { call, pending, events } = fixture('auto')
  const result = call('AskUserQuestion', { questions: [] })
  expect(events).toEqual([expect.objectContaining({ kind: 'question' })])
  ;[...pending.values()][0]!.resolve({ behavior: 'allow', updatedInput: { answers: {} } })
  expect(await result).toMatchObject({ updatedInput: { answers: {} } })
})

it('restricted reviews continue to deny non-Ramu tools even in Auto', async () => {
  const { call, events } = fixture('auto', true)
  expect(await call('Bash')).toMatchObject({ behavior: 'deny' })
  expect(await call('mcp__external__tool_invoke')).toMatchObject({ behavior: 'deny' })
  expect(await call('mcp__ramu__memory_read')).toMatchObject({ behavior: 'allow' })
  expect(events).toEqual([])
})
