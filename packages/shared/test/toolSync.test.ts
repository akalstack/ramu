import { describe, expect, it } from 'vitest'
import { transferChanges, settingsExportSchema, type SettingsExport } from '../src/settingsTransfer'
import { DEFAULT_APP_PREFERENCES } from '../src/types'
import { availableOn, portableToolSchema, toolKey, toolState, type PortableTool, type ToolsHere } from '../src/toolSync'

const here = (overrides: Partial<ToolsHere> = {}): ToolsHere => ({
  plugins: [],
  skills: [],
  mcp: [],
  hasCommand: () => true,
  ...overrides,
})

const linear: PortableTool = {
  kind: 'plugin',
  name: 'linear',
  index: 'https://github.com/akalstack/ramu-plugins',
  location: 'https://github.com/linear/linear-plugin',
  path: '',
  commit: 'abc1234',
  identityId: null,
  servers: { linear: { list_issues: 'allow', create_issue: 'ask' } },
}

const server = (transport: Extract<PortableTool, { kind: 'mcp' }>['transport']): PortableTool => ({
  kind: 'mcp',
  name: 'Docs',
  transport,
  providers: ['claude-code', 'codex'],
  tools: { search: 'allow' },
})

describe('tools across hosts', () => {
  it('compares a plugin by its pinned commit', () => {
    expect(toolState(linear, here())).toBe('new')
    expect(toolState(linear, here({ plugins: [{ name: 'linear', commit: 'abc1234' }] }))).toBe('same')
    expect(toolState(linear, here({ plugins: [{ name: 'linear', commit: 'def5678' }] }))).toBe('update')
  })

  it('compares an installed skill by source and a written one by its text', () => {
    const installed: PortableTool = {
      kind: 'skill',
      name: 'review',
      description: 'Review a diff',
      source: 'acme/skills',
      content: null,
    }
    expect(toolState(installed, here({ skills: [{ name: 'review', source: 'acme/skills', content: 'x' }] }))).toBe(
      'same',
    )
    const written: PortableTool = { ...installed, source: null, content: 'Check tests first.' }
    expect(toolState(written, here({ skills: [{ name: 'review', source: null, content: 'Something else' }] }))).toBe(
      'update',
    )
  })

  it('matches a server by its address, and asks to connect one whose command this host lacks', () => {
    const http = server({ type: 'http', url: 'https://docs.example.com/mcp/', headers: ['Authorization'] })
    expect(toolState(http, here({ mcp: [{ name: 'Other name', address: 'https://docs.example.com/mcp' }] }))).toBe(
      'same',
    )
    const stdio = server({ type: 'stdio', command: 'uvx', args: ['docs-mcp'], cwd: '~', env: ['DOCS_TOKEN'] })
    expect(toolState(stdio, here({ hasCommand: () => false }))).toBe('connect-here')
    expect(toolState(stdio, here())).toBe('new')
  })

  it('never takes a secret value or a folder outside the home folder', () => {
    const stdio = server({ type: 'stdio', command: 'uvx', args: [], cwd: '/srv/docs', env: [] })
    expect(portableToolSchema.safeParse(stdio).success).toBe(false)
    const withValue = { ...linear, servers: { linear: { list_issues: 'yes' } } }
    expect(portableToolSchema.safeParse(withValue).success).toBe(false)
    expect(toolKey(linear)).toBe('plugin:linear')
  })

  it('keeps a tool on the hosts chosen for it', () => {
    expect(availableOn(undefined, 'home')).toBe(false)
    expect(availableOn({ all: true }, 'home')).toBe(true)
    expect(availableOn({ hosts: ['work'] }, 'home')).toBe(false)
  })

  it('lists tools in Copy settings as waiting for review, only in the chosen groups', () => {
    const file: SettingsExport = settingsExportSchema.parse({
      format: 'ramu-settings',
      version: 2,
      exportedAt: 1,
      host: 'laptop',
      groups: ['plugins', 'mcp'],
      preferences: {},
      tools: [linear, server({ type: 'stdio', command: 'uvx', args: [], cwd: '~', env: [] })],
    })
    const current = {
      preferences: DEFAULT_APP_PREFERENCES,
      models: null,
      rules: [],
      identities: { identities: [], accounts: {}, pins: {} },
      notes: [],
      tools: here({ hasCommand: () => false }),
    }
    expect(transferChanges(current, file, ['plugins', 'mcp']).map((change) => [change.label, change.before])).toEqual([
      ['Plugin: linear', null],
      ['MCP server: Docs', 'Not set up here'],
    ])
    expect(transferChanges(current, file, ['mcp'])).toHaveLength(1)
  })
})
