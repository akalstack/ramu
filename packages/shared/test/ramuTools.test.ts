import { describe, expect, it } from 'vitest'
import { describeRamuTool, ramuTool, ramuToolHasOwnUi, summarizeAgentStatuses } from '../src/ramuTools'

const use = (name: string, input?: unknown, summary = '') => ({
  name,
  summary: summary || (input ? JSON.stringify(input) : ''),
  ...(input ? { input: JSON.stringify(input, null, 2) } : {}),
})

describe('Ramu tool calls', () => {
  it('recognises each provider’s naming', () => {
    expect(ramuTool(use('mcp__ramu__memory_search', { query: 'tabs' }))).toEqual({
      name: 'memory_search',
      args: { query: 'tabs' },
    })
    expect(ramuTool({ name: 'memory_search', summary: 'ramu', input: '{"query":"tabs"}' })?.name).toBe('memory_search')
    expect(ramuTool(use('ramu_skill_read', { id: 's1' }))?.name).toBe('skill_read')
    expect(ramuTool(use('memory_search', { query: 'x' }))).toBeNull()
    expect(ramuTool(use('mcp__other__memory_search'))).toBeNull()
    expect(ramuTool(use('mcp__ramu__made_up'))).toBeNull()
  })

  it('unwraps tool_invoke', () => {
    const call = ramuTool(
      use('mcp__ramu__tool_invoke', { name: 'memory_save', arguments: { title: 'Tabs', kind: 'user' } }),
    )
    expect(call).toEqual({ name: 'memory_save', args: { title: 'Tabs', kind: 'user' } })
    expect(ramuTool(use('mcp__ramu__tool_invoke', { name: 'tool_invoke', arguments: {} }))?.name).toBe('tool_invoke')
  })

  it('hides only calls that already have a place in the chat', () => {
    for (const name of [
      'ask_user',
      'wait_for_answer',
      'set_goal',
      'update_goal',
      'schedule_create',
      'ramu_agent',
      'advisor',
    ])
      expect(ramuToolHasOwnUi(use(`mcp__ramu__${name}`)), name).toBe(true)
    expect(ramuToolHasOwnUi(use('mcp__ramu__tool_invoke', { name: 'schedule_create', arguments: {} }))).toBe(true)
    for (const name of ['memory_save', 'skill_read', 'schedule_list', 'tool_search', 'message_parent'])
      expect(ramuToolHasOwnUi(use(`mcp__ramu__${name}`)), name).toBe(false)
    expect(ramuToolHasOwnUi(use('Bash', { command: 'ls' }))).toBe(false)
  })

  it('describes calls without raw JSON', () => {
    expect(
      describeRamuTool({
        name: 'memory_save',
        args: { title: 'Tabs', kind: 'user', scope: 'global', content: 'Uses tabs' },
      }),
    ).toMatchObject({ done: 'Saved memory', running: 'Saving memory', subject: '“Tabs”', icon: 'brain' })
    expect(
      describeRamuTool({ name: 'skill_read', args: { id: 's1' } }, JSON.stringify({ name: 'Release steps' })).subject,
    ).toBe('“Release steps”')
    expect(describeRamuTool({ name: 'schedule_pause', args: { paused: false } }).done).toBe('Resumed a schedule')
    expect(describeRamuTool({ name: 'rtk_run', args: { arguments: ['git', 'status'] } })).toMatchObject({
      icon: 'terminal',
      subject: 'rtk git status',
    })
    expect(describeRamuTool({ name: 'memory_read', args: { id: 'm1' } }, 'not json').subject).toBeUndefined()
  })

  it('summarises agent states', () => {
    expect(summarizeAgentStatuses(['running', 'completed', 'completed', 'failed'])).toBe(
      '1 running · 1 failed · 2 done',
    )
    expect(summarizeAgentStatuses([])).toBe('')
  })
})
