import { describe, expect, it } from 'vitest'
import { agentContent } from '@ramu/shared/chat/agentContent'
import { toolFallbackTitle } from '../src/views/agent/lib/toolSummary'
import type { ToolUse } from '../src/views/agent/types'

const use = (over: Partial<ToolUse>) =>
  ({ kind: 'tool-use', toolUseId: '1', name: 'x', summary: '', ...over }) as ToolUse

describe('toolFallbackTitle', () => {
  it('names the tools a tool search loaded', () => {
    const search = use({ name: 'ToolSearch', summary: 'select:mcp__ramu__ask_user' })
    expect(toolFallbackTitle(search, false)).toBe('Loaded ask_user')
  })

  it('shows the tool name instead of its raw JSON input', () => {
    const call = use({ name: 'addWorklogToJiraIssue', summary: '{"cloudId":"abc","issueIdOrKey":"G-1"}' })
    expect(toolFallbackTitle(call, false)).toBe('Used addWorklogToJiraIssue')
  })

  it('leaves tools with a title or a readable summary alone', () => {
    expect(toolFallbackTitle(use({ title: 'Read file', summary: '{"a":1}' }), false)).toBeNull()
    expect(toolFallbackTitle(use({ name: 'Bash', summary: 'ls' }), false)).toBeNull()
  })
})

it('shows loaded tool references as their tool name', () => {
  expect(agentContent([{ type: 'tool_reference', tool_name: 'mcp__ramu__ask_user' }])).toEqual([
    { type: 'text', text: 'mcp__ramu__ask_user' },
  ])
})
