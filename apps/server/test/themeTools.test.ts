import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_THEME } from '@ramu/shared/theme'
import { ToolRegistry } from '../src/agent/toolRegistry'
import { registerThemeTools } from '../src/themeTools'

const extra = { signal: new AbortController().signal } as Parameters<ToolRegistry['invoke']>[2]

function setup() {
  const proposed = vi.fn()
  const registry = new ToolRegistry(new McpServer({ name: 'test', version: '1' }), true)
  registerThemeTools(registry.server, proposed)
  return { proposed, registry }
}
const input = (text?: string) => ({
  name: 'Calm',
  light: { overlay: 'black', colors: DEFAULT_THEME.light.colors },
  dark: { overlay: 'white', colors: { ...DEFAULT_THEME.dark.colors, ...(text ? { text } : {}) } },
})

describe('propose_theme', () => {
  it('is found by a theme search and records a valid draft as a card without applying anything', async () => {
    const { proposed, registry } = setup()
    expect(registry.search('theme colors', 10).some((tool) => tool.name === 'propose_theme')).toBe(true)
    const result = await registry.invoke('propose_theme', input(), extra)
    expect(result.isError).not.toBe(true)
    expect(proposed).toHaveBeenCalledTimes(1)
    expect(proposed.mock.calls[0]![0].id).toMatch(/^ai-/)
  })

  it('returns readability failures for repair and records nothing', async () => {
    const { proposed, registry } = setup()
    const result = await registry.invoke('propose_theme', input('#25252a'), extra)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('dark.text')
    expect(proposed).not.toHaveBeenCalled()
  })
})
