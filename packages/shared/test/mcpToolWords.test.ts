import { describe, expect, it } from 'vitest'
import { mcpToolWords } from '../src/chat/mcpToolWords'
import { ramuTool } from '../src/chat/ramuTools'

describe('MCP tool words', () => {
  it('reads a server tool as its own words and drops a title that only repeats the name', () => {
    expect(mcpToolWords('mcp__linear__create_issue', 'Run mcp__linear__create_issue')).toEqual({
      verb: 'Create issue',
      subject: '',
    })
    expect(mcpToolWords('mcp_github_list-pulls', 'Run mcp_github_list-pulls')).toEqual({
      verb: 'List pulls',
      subject: '',
    })
    expect(mcpToolWords('mcp__linear__create_issue', 'Bug in login')).toEqual({
      verb: 'Create issue',
      subject: 'Bug in login',
    })
  })

  it('leaves other tools as they are', () => {
    expect(mcpToolWords('Bash', 'npm test')).toEqual({ verb: 'Bash', subject: 'npm test' })
  })

  it("knows Antigravity's names for Ramu's own tools", () => {
    expect(ramuTool({ name: 'mcp_ramu_set_goal', summary: '' })?.name).toBe('set_goal')
    expect(ramuTool({ name: 'mcp_ramu_not_a_tool', summary: '' })).toBeNull()
  })
})
