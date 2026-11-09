import { SettingsScopeContext, type SettingsScope } from '../src/settings/SettingsScope'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { SharedMcpManagement } from '@ramu/shared/mcp'
import { McpSettings } from '../src/settings/McpSettings'

vi.mock('../src/i18n', () => ({ useLanguage: () => {}, t: (text: string) => text }))
vi.mock('../src/settings/SettingsScope', async () => {
  const { createContext } = await import('react')
  return {
    SettingsScopeContext: createContext(null),
    useSettingsInvoke: () => vi.fn(),
    useSettingsEvents: () => () => () => {},
  }
})
vi.mock('../src/workspace/workspace', () => ({ useWorkspace: () => ({ composing: 'project' }) }))
vi.mock('../src/models/ModelSets', () => ({ useModelSets: () => ({ preferences: { sets: [], defaultStepId: '' } }) }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { providerBinaries: {} } }) }))
vi.mock('../src/ipc', () => ({ ramu: { invoke: vi.fn() } }))
vi.mock('../src/Menu', () => ({ Dialog: () => null, Dropdown: () => null }))
// Identities are their own concern, read from the host's identity store; these settings render without them.
vi.mock('../src/settings/AccountIdentity', () => ({
  useAccountIdentities: () => ({
    identities: null,
    viewOnly: false,
    identity: () => null,
    ownerOf: () => '',
    setOwner: () => {},
    assign: async () => {},
    suggestedFor: () => '',
  }),
  AccountIdentityPicker: () => null,
  IdentityDropdown: () => null,
  IdentityName: () => null,
}))

const snapshot: SharedMcpManagement = {
  hostId: 'host',
  credentialStore: 'not-checked',
  accounts: [],
  readiness: [],
  uncertainCalls: 0,
  connections: [
    {
      connection: {
        id: 'connection',
        hostId: 'host',
        revision: '1',
        name: 'Project tracker',
        serviceAccountId: 'alice',
        enabled: true,
        scope: { projectIds: ['project'], hostWide: false },
        providers: ['claude-code', 'codex'],
        transport: { type: 'http', url: 'https://tracker.example/mcp', headerSecretRefs: {} },
      },
      status: 'not-connected',
      checkedAt: null,
    },
  ],
}
function render(canAdminister: boolean, state = snapshot, viewer = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['mcp-settings', ''], { ...state, canAdminister })
  client.setQueryData(['mcp-projects', ''], [{ id: 'project', name: 'Selected project' }])
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
                  available: [],
                  ready: true,
                  stale: false,
                  targets: [{ viewOnly: true }],
                } as unknown as SettingsScope)
              : null,
          },
          createElement(McpSettings),
        ),
      ),
    )
  } finally {
    client.clear()
  }
}

it('names the server, selected project and providers without claiming native-runtime readiness', () => {
  const html = render(true)
  expect(html).toContain('Project tracker')
  expect(html).toContain('Selected project')
  expect(html).toContain('Claude')
  expect(html).toContain('Codex')
  expect(html).toContain('Not connected')
  expect(html).not.toContain('Ready')
  expect(html).not.toContain('alice') // an unverified service-account ID is not presented as authenticated identity
})

it('offers OAuth sign-in on a remote server only to the host administrator', () => {
  expect(render(true)).toMatch(/<button(?![^>]* disabled="")[^>]*>Sign in<\/button>/)
  expect(render(false)).toMatch(/<button[^>]* disabled=""[^>]*>Sign in<\/button>/)
})

it('renders administration unavailable for a paired client while preserving status', () => {
  const html = render(false)
  expect(html).toContain('Manage MCP connections and credentials on the host running Ramu')
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Add server<\/button>/)
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Connect<\/button>/)
  expect(html).toContain('Project tracker')
})

it('keeps authentication failures distinct and presents an actionable empty state', () => {
  const html = render(true, {
    ...snapshot,
    connections: [
      {
        ...snapshot.connections[0]!,
        status: 'sign-in-required',
        reason: 'Sign in to the external service before connecting this server.',
      },
    ],
  })
  expect(html).toContain('Sign-in required')
  expect(html).toContain('Sign in to the external service')
  expect(html).toMatch(/<button[^>]*>Sign in again<\/button>/)
  const empty = render(true, { ...snapshot, connections: [] })
  expect(empty).toContain('No servers connected through Ramu yet.')
})

it('does not reuse a cached administrator grant after viewer access is known', () => {
  const html = render(true, snapshot, true)
  expect(html).toContain('Project tracker')
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Add server<\/button>/)
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Connect<\/button>/)
})
