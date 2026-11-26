import { describe, expect, it } from 'vitest'
import { mcpCallSkipsCard, selfGatedRamuTool } from '../src/agent/toolApprovals'

describe('mcpCallSkipsCard', () => {
  it('skips the card for Shared MCP calls in every mode, since the gateway asks for each call itself', () => {
    for (const access of ['edits', 'auto', 'full'] as const)
      expect(mcpCallSkipsCard(access, 'shared_mcp', 'Linear-abc123__create_issue')).toBe(true)
  })

  it('trusts every Ramu tool in Auto and Full, and in Allow edits only those that ask or only manage the chat', () => {
    expect(mcpCallSkipsCard('auto', 'ramu', 'schedule_create')).toBe(true)
    expect(mcpCallSkipsCard('full', 'ramu', 'memory_save')).toBe(true)
    for (const tool of [
      'ask_user',
      'run_script',
      'settings_change',
      'browser_click',
      'computer_observe',
      'ask_parent',
      'background_wait',
    ])
      expect(mcpCallSkipsCard('edits', 'ramu', tool), tool).toBe(true)
    for (const tool of ['schedule_create', 'memory_save', 'generate_image'])
      expect(mcpCallSkipsCard('edits', 'ramu', tool), tool).toBe(false)
  })

  it('never answers for another server', () => {
    expect(mcpCallSkipsCard('auto', 'other', 'ask_user')).toBe(false)
  })
})

describe('selfGatedRamuTool', () => {
  it('judges a deferred call by the tool it invokes', () => {
    expect(selfGatedRamuTool('tool_invoke', { name: 'set_goal', arguments: {} })).toBe(true)
    expect(selfGatedRamuTool('tool_invoke', { name: 'schedule_create', arguments: {} })).toBe(false)
    expect(selfGatedRamuTool('tool_invoke', {})).toBe(false)
  })
})
