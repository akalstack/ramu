import { SettingsScopeContext, type SettingsScope } from '../src/settings/SettingsScope'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ProjectMcpServer, ProjectSetup } from '@ramu/shared/mcp'
import { AgentSetup, type SetupView } from '../src/settings/AgentSetup'

vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`)),
}))
vi.mock('../src/settings/SettingsScope', async () => {
  const { createContext } = await import('react')
  return {
    SettingsScopeContext: createContext(null),
    SettingsField: ({ children }: { children: unknown }) => children,
    SettingsFieldNotice: () => null,
    useSettingsInvoke: () => vi.fn(),
    useSettingsEvents: () => () => () => {},
  }
})
vi.mock('../src/workspace/workspace', () => ({ useWorkspace: () => ({ composing: 'project' }) }))
vi.mock('../src/Menu', () => ({ Dialog: () => null, Dropdown: () => null }))
vi.mock('../src/ipc', () => ({ ramu: { invoke: vi.fn(async () => undefined) } }))
vi.mock('../src/settings/McpSettings', () => ({ McpSettings: () => null }))

const server = (overrides: Partial<ProjectMcpServer>): ProjectMcpServer => ({
  key: overrides.name ?? 'k',
  name: 'atlassian',
  transport: { type: 'http', url: 'https://pentools.example/mcp/atlassian' },
  envKeys: [],
  headerKeys: ['X-Key'],
  providers: ['codex'],
  nativeProviders: ['codex'],
  scope: 'user',
  sources: [{ scope: 'user', label: 'Codex', file: '~/.codex/config.toml', provider: 'codex', enabled: true }],
  nameConflict: false,
  shared: false,
  shareScope: 'default',
  ...overrides,
})

function render(setup: Partial<ProjectSetup>, viewer = false, view: SetupView = 'mcp') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['mcp-projects', ''], [{ id: 'project', name: 'Lionparcel' }])
  client.setQueryData(['mcp-settings', ''], { canAdminister: true, connections: [] })
  // The screen opens on every project; a project is picked to see its own items or make an exception.
  client.setQueryData(['project-setup', '', 'all'], {
    projectId: null,
    roots: [],
    mcp: [],
    skills: [],
    diagnostics: [],
    ...setup,
  })
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          SettingsScopeContext.Provider,
          {
            value: viewer
              ? ({
                  primaryId: '',
                  ready: true,
                  stale: false,
                  targets: [{ viewOnly: true }],
                } as unknown as SettingsScope)
              : null,
          },
          createElement(AgentSetup, { initialView: view }),
        ),
      ),
    )
  } finally {
    client.clear()
  }
}

it('offers one switch per server and says who gets it now', () => {
  const html = render({
    mcp: [
      server({}),
      server({
        name: 'knowledge',
        key: 'kb',
        shared: true,
        providers: ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'],
      }),
    ],
  })
  expect(html).toContain('Share atlassian with every provider and account')
  expect(html).toContain('Only in Codex · From ~/.codex/config.toml')
  expect(html).toContain('Shared with every provider and account')
  expect(html).toContain('Available in Claude, Codex, OpenCode, Cursor, Antigravity')
  expect(html).not.toContain('X-Key')
})

it('explains why a server cannot be shared and disables its switch', () => {
  const html = render({
    mcp: [server({ name: 'app', shareBlocked: 'It runs a command relative to one provider’s folder.' })],
  })
  expect(html).toContain('It runs a command relative to one provider’s folder.')
  expect(html).toMatch(
    /aria-label="Share app with every provider and account"[^>]*disabled|disabled[^>]*aria-label="Share app/,
  )
})

it('lists skills with where they come from', () => {
  const html = render(
    {
      skills: [
        {
          name: 'review-pr',
          description: 'Reviews a pull request.',
          providers: ['claude-code', 'opencode'],
          nativeProviders: ['claude-code', 'opencode'],
          shared: false,
          shareScope: 'default',
          scope: 'project',
          sources: [
            {
              scope: 'project',
              label: 'agent-knowledge-workflow',
              file: '.claude/skills/review-pr/SKILL.md',
              enabled: true,
            },
          ],
          nameConflict: false,
        },
      ],
    },
    false,
    'skills',
  )
  expect(html).toContain('review-pr')
  expect(html).toContain('Share review-pr with every provider and account')
  expect(html).toContain('From agent-knowledge-workflow/.claude/skills/review-pr/SKILL.md')
})

it('opens on every project, says so, and counts the projects that chose differently', () => {
  const html = render({
    mcp: [server({ name: 'atlassian', shared: true, shareScope: 'host', exceptions: 2 })],
  })
  expect(html).toContain('Your settings')
  expect(html).toContain('Every project. Choose one to see its own servers and skills, or to make an exception.')
  expect(html).toContain('gives it to every provider and account in every project')
  expect(html).toContain('Different in 2 projects')
  // Connecting through Ramu creates a connection for one project, so it is offered once a project is chosen.
  expect(html).not.toContain('Connect through Ramu')
})

it('lists provider-managed servers apart from declared ones, with a connectors link only where one exists', () => {
  const html = render({
    providerManaged: [
      { provider: 'claude-code', name: 'claude.ai Figma' },
      { provider: 'codex', name: 'Codex connector' },
    ],
  })
  expect(html).toContain('Managed by the provider')
  expect(html).toContain('claude.ai Figma')
  expect(html).toContain('Codex connector')
  expect(html.match(/Manage connectors/g)).toHaveLength(1)
  expect(html).toMatch(/<a\b[^>]*href="[^"]+"[^>]*>Manage connectors<\/a>/)
  expect(render({})).not.toContain('Managed by the provider')
})

it('shows one concern at a time, with a count on the tabs that have items', () => {
  const html = render({ mcp: [server({})] })
  expect(html).toContain('MCP servers')
  expect(html).toContain('Skills')
  expect(html).toContain('Rules')
  expect(html).toContain('atlassian')
  expect(html).not.toContain('Search skills')
  expect(render({}, false, 'skills')).toContain('No skills found yet.')
  expect(render({}, false, 'skills')).not.toContain('No MCP servers found yet.')
})

it('keeps setup readable but disables sharing when a cached admin snapshot belongs to a viewer', () => {
  const html = render({ mcp: [server({})] }, true)
  expect(html).toContain('atlassian')
  expect(html).toMatch(
    /aria-label="Share atlassian with every provider and account"[^>]*disabled|disabled[^>]*aria-label="Share atlassian/,
  )
})
