import { describe, expect, it } from 'vitest'
import type { SharedMcpManagement } from '@ramu/shared/mcp'
import type { InstalledPlugin } from '@ramu/shared/plugins'
import type { ManagedSkill } from '@ramu/shared/types'
import {
  dismissTool,
  portableTools,
  receiveTools,
  toolSyncStatus,
  waitingTools,
  type ToolSources,
} from '../src/toolSync'
import type { Workspace } from '../src/workspace/workspace'

const appState = () => {
  const state = new Map<string, unknown>()
  return {
    getAppState: <T>(key: string, fallback: T) => (state.has(key) ? (state.get(key) as T) : fallback),
    setAppState: (key: string, value: unknown) => void state.set(key, value),
  } as unknown as Workspace
}

const plugin = (overrides: Partial<InstalledPlugin> = {}): InstalledPlugin =>
  ({
    id: 'p1',
    name: 'linear',
    source: {
      kind: 'git',
      location: 'https://github.com/linear/plugin',
      path: '',
      commit: 'abc1234',
      index: null,
      signedBy: null,
    },
    scope: { kind: 'all' },
    mcpConnections: [{ name: 'linear', id: 'c-linear' }],
    credentials: [{ id: 'token', label: 'API key', state: 'saved', account: 'me', identities: [] }],
    ...overrides,
  }) as InstalledPlugin

const connection = (
  id: string,
  transport: SharedMcpManagement['connections'][number]['connection']['transport'],
  granted: { name: string; approval: 'always' | 'connection' }[] = [],
): SharedMcpManagement['connections'][number] => ({
  connection: {
    id,
    hostId: 'h',
    name: id,
    serviceAccountId: 'public',
    revision: '1',
    enabled: true,
    scope: { hostWide: true, projectIds: [] },
    providers: ['claude-code'],
    transport,
  },
  status: 'connected',
  checkedAt: null,
  granted: granted.length ? [{ provider: 'claude-code', accountId: 'a', tools: granted }] : [],
})

const skill = (overrides: Partial<ManagedSkill>): ManagedSkill =>
  ({
    id: overrides.name,
    projectId: null,
    description: 'Does a thing',
    content: 'Steps',
    status: 'active',
    pinned: true,
    changedBy: 'user',
    sourceSessionId: '',
    ...overrides,
  }) as ManagedSkill

const sources = (workspace = appState()): ToolSources => {
  const home = process.env.HOME ?? '/home/me'
  return {
    workspace,
    plugins: {
      list: () => [plugin(), plugin({ id: 'p2', name: 'mine', source: { ...plugin().source, kind: 'folder' } })],
    },
    getSharedMcp: () => ({
      list: () =>
        ({
          connections: [
            connection('c-linear', { type: 'http', url: 'https://mcp.linear.app/mcp', headerSecretRefs: {} }, [
              { name: 'list_issues', approval: 'connection' },
            ]),
            connection(
              'docs',
              { type: 'http', url: 'https://docs.example.com/mcp', headerSecretRefs: { Authorization: 'ref-1' } },
              [
                { name: 'search', approval: 'connection' },
                { name: 'write', approval: 'always' },
              ],
            ),
            connection('local', { type: 'stdio', command: './server.js', args: [], cwd: home, envSecretRefs: {} }),
          ],
        }) as SharedMcpManagement,
    }),
    learning: {
      skills: () => [
        skill({ name: 'written' }),
        skill({ name: 'learned', changedBy: 'learning', sourceSessionId: 's1' }),
        skill({
          name: 'from-plugin',
          installation: { source: 'plugin:linear', skill: 'x', cliVersion: '1', markdown: '', files: {} },
        }),
        skill({ name: 'per-project', projectId: 'p' }),
      ],
    },
  }
}

describe('tools across hosts on the server', () => {
  it('exports setup without secrets, and says what stays', () => {
    const { tools, skipped } = portableTools(sources())
    expect(tools.map((tool) => `${tool.kind}:${tool.name}`)).toEqual(['plugin:linear', 'skill:written', 'mcp:docs'])
    const linear = tools.find((tool) => tool.kind === 'plugin')!
    expect(linear.kind === 'plugin' && linear.servers).toEqual({ linear: { list_issues: 'allow' } })
    const docs = tools.find((tool) => tool.kind === 'mcp')!
    expect(docs.kind === 'mcp' && docs.transport).toEqual({
      type: 'http',
      url: 'https://docs.example.com/mcp',
      headers: ['Authorization'],
    })
    expect(docs.kind === 'mcp' && docs.tools).toEqual({ search: 'allow', write: 'ask' })
    expect(JSON.stringify(tools)).not.toContain('ref-1')
    expect(skipped).toEqual([
      { kind: 'plugin', name: 'mine', reason: 'folder' },
      { kind: 'skill', name: 'per-project', reason: 'project' },
      { kind: 'mcp', name: 'local', reason: 'folder' },
    ])
  })

  it('keeps what another host sent until this host has it or it is dismissed', () => {
    const laptop = portableTools(sources()).tools
    const workspace = appState()
    const empty: ToolSources = { workspace }
    expect(receiveTools(empty, laptop, 'laptop')).toBe(3)
    expect(waitingTools(empty).map((entry) => [entry.key, entry.state, entry.from])).toEqual([
      ['plugin:linear', 'new', 'laptop'],
      ['skill:written', 'new', 'laptop'],
      ['mcp:docs', 'new', 'laptop'],
    ])
    dismissTool(workspace, 'skill:written')
    expect(waitingTools(empty)).toHaveLength(2)
    // Sent again unchanged, a dismissed tool stays dismissed; a changed one comes back.
    expect(receiveTools(empty, laptop, 'laptop')).toBe(2)
    const edited = laptop.map((tool) => (tool.kind === 'skill' ? { ...tool, content: 'New steps' } : tool))
    expect(receiveTools(empty, edited, 'laptop')).toBe(3)
    // Once the same tools are installed here only the changed skill waits, as an update.
    expect(waitingTools(sources(workspace)).map((entry) => [entry.key, entry.state])).toEqual([
      ['skill:written', 'update'],
    ])
    expect(receiveTools(sources(appState()), laptop, 'laptop')).toBe(0)
  })

  it('drops a host choice for a tool that is no longer here', () => {
    const workspace = appState()
    workspace.setAppState('tool-sync-availability', { 'plugin:linear': { all: true }, 'plugin:gone': { all: true } })
    expect(toolSyncStatus(sources(workspace)).availability).toEqual({ 'plugin:linear': { all: true } })
  })
})
