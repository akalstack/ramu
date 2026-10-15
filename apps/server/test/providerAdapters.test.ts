import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { PROVIDER_ADAPTERS, providerAdapter } from '../src/providers/adapters'
import { defineAdapter, parseProviderVersion } from '../src/providers/adapter'
import { ProviderService } from '../src/providers/providers'
import { providerAccountClearedEnv, providerAccountEnv } from '../src/providers/providerBinaries'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'

const savedEnv = { ...process.env }
afterEach(() => {
  process.env = { ...savedEnv }
})

describe('provider adapter registry', () => {
  it('has exactly one adapter per provider, keyed by its own id', () => {
    expect(Object.keys(PROVIDER_ADAPTERS).sort()).toEqual([...AGENT_PROVIDERS].sort())
    for (const id of AGENT_PROVIDERS) expect(providerAdapter(id).id).toBe(id)
  })

  it('keeps the RAMU_*_BIN override names', () => {
    expect(Object.fromEntries(AGENT_PROVIDERS.map((id) => [id, providerAdapter(id).binaryEnvVar]))).toEqual({
      'claude-code': 'RAMU_CLAUDE_BIN',
      codex: 'RAMU_CODEX_BIN',
      opencode: 'RAMU_OPENCODE_BIN',
      cursor: 'RAMU_CURSOR_BIN',
      antigravity: 'RAMU_ANTIGRAVITY_BIN',
    })
  })

  it('names executables and search directories', () => {
    expect(providerAdapter('cursor').executableNames()).toEqual(['agent', 'cursor-agent'])
    expect(providerAdapter('claude-code').executableNames()).toEqual(['claude'])
    expect(providerAdapter('opencode').searchDirs('/h')[0]).toBe('/h/.opencode/bin')
    expect(providerAdapter('codex').searchDirs('/h')).toEqual(['/h/.local/bin', '/opt/homebrew/bin', '/usr/local/bin'])
  })

  it('maps account profile environments', () => {
    expect(providerAccountEnv('codex', '/r')).toEqual({ CODEX_HOME: '/r' })
    expect(providerAccountEnv('claude-code', '/r')).toEqual({ CLAUDE_CONFIG_DIR: '/r' })
    expect(providerAccountEnv('antigravity', '/r')).toEqual({ GEMINI_HOME: '/r' })
    expect(Object.keys(providerAccountEnv('cursor', '/r'))).toContain('AGENT_CLI_CREDENTIAL_STORE')
    expect(providerAccountClearedEnv('codex')).toEqual(['OPENAI_API_KEY', 'CODEX_API_KEY'])
  })

  it('only offers terminal login and self-update where the CLI supports them', () => {
    expect(Object.fromEntries(AGENT_PROVIDERS.map((id) => [id, providerAdapter(id).loginArgs]))).toEqual({
      'claude-code': ['auth', 'login'],
      codex: ['login'],
      opencode: ['auth', 'login'],
      cursor: ['login'],
      antigravity: null,
    })
    expect(providerAdapter('antigravity').signIn).toBeTypeOf('function')
    for (const id of AGENT_PROVIDERS.filter((id) => id !== 'antigravity'))
      expect(providerAdapter(id).signIn).toBeUndefined()
  })

  it('plans updates with injected fakes', () => {
    const base = {
      config: {},
      binary: '/bin/tool',
      findExecutable: (command: string) => (command === 'npm' || command === '/bin/tool' ? command : null),
      runtimeHome: '/runtime/codex',
      installRuntime: async () => {},
    }
    expect(providerAdapter('claude-code').updatePlan(base)).toEqual({ command: '/bin/tool', args: ['update'] })
    expect(providerAdapter('opencode').updatePlan(base)).toEqual({ command: '/bin/tool', args: ['upgrade'] })
    expect(providerAdapter('codex').updatePlan(base)).toEqual({
      command: 'npm',
      args: ['install', '--prefix', '/runtime/codex', '--no-audit', '--no-fund', '@openai/codex@latest'],
    })
    expect(() => providerAdapter('cursor').updatePlan({ ...base, findExecutable: () => null })).toThrow(
      'Select an installed CLI before updating it.',
    )
    expect(() => providerAdapter('codex').updatePlan({ ...base, config: { codex: { binary: '/x' } } })).toThrow(
      'Update this custom Codex installation',
    )
    expect(() =>
      providerAdapter('antigravity').updatePlan({ ...base, config: { antigravity: { binary: '/x' } } }),
    ).toThrow('Update this custom Antigravity runtime')
    expect('install' in providerAdapter('antigravity').updatePlan(base)).toBe(true)
  })

  it('keeps opencode releases on the installed major line', () => {
    const line = providerAdapter('opencode').sameReleaseLine!
    expect(line('1.2.3', '1.9.0')).toBe(true)
    expect(line('1.2.3', '2.0.0')).toBe(false)
    expect(line(null, '2.0.0')).toBe(true)
  })

  it('reports sign-in unavailable for Antigravity without a settings file', async () => {
    expect(await providerAdapter('antigravity').signInState('x', { GEMINI_HOME: '/nonexistent/ramu' })).toEqual({
      signedIn: false,
    })
  })

  it('defineAdapter supplies default search directories and the version probe', () => {
    const { searchDirs: _searchDirs, probeVersion: _probeVersion, ...rest } = providerAdapter('codex')
    const adapter = defineAdapter(rest)
    expect(adapter.searchDirs('/h')).toEqual(['/h/.local/bin', '/opt/homebrew/bin', '/usr/local/bin'])
    expect(adapter.probeVersion).toBeTypeOf('function')
  })

  it('parses provider versions', () => {
    expect(parseProviderVersion('codex-cli 0.12.3')).toBe('0.12.3')
    expect(parseProviderVersion('2025.01.02-abc123')).toBe('2025.01.02-abc123')
  })
})

describe('login command shapes', () => {
  const service = (binary: string) =>
    new ProviderService(
      () => ({
        ...DEFAULT_APP_PREFERENCES,
        providerBinaries: { codex: { binary }, cursor: { binary }, antigravity: { binary } },
      }),
      (_key, fallback) => fallback,
      () => {},
      () => {},
    )

  it('quotes the binary and appends the adapter login args', () => {
    const quoted = process.platform === 'win32' ? "& '/b/tool'" : "'/b/tool'"
    expect(service('/b/tool').loginCommand('codex')).toBe(`${quoted} login`)
    expect(service('/b/tool').loginCommand('cursor')).toBe(`${quoted} login`)
  })

  it('has no terminal login for Antigravity', () => {
    expect(service('/b/tool').loginCommand('antigravity')).toBeNull()
  })

  it('refuses in-app sign-in for providers that use the terminal command', async () => {
    await expect(service('/b/tool').signIn('codex')).rejects.toThrow('Use the Login command for this provider.')
  })
})
