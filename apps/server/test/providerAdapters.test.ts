import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { antigravityKeyName, antigravitySignInProblem } from '@ramu/shared/providers/environment'
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
    expect(providerAccountEnv('antigravity', '/r')).toEqual({ GEMINI_HOME: '/r', AGY_ACP_FORCE_FILE_STORAGE: '1' })
    expect(providerAccountEnv('cursor', '/r')).toMatchObject({
      AGENT_CLI_CREDENTIAL_STORE: 'file',
      RAMU_CURSOR_SDK_DIR: '/r/sdk',
    })
    expect(providerAccountClearedEnv('codex')).toEqual(['OPENAI_API_KEY', 'CODEX_API_KEY'])
  })

  it('keeps every login in a file, including the default account, so the macOS Keychain is never used', () => {
    const ctx = { overrides: {}, binary: () => '/x/agy_acp_server.par', expand: (path: string) => path }
    expect(providerAdapter('antigravity').extendEnvironment!({}, ctx)).toMatchObject({
      AGY_ACP_FORCE_FILE_STORAGE: '1',
    })
    expect(providerAdapter('cursor').extendEnvironment!({}, ctx)).toMatchObject({ AGENT_CLI_CREDENTIAL_STORE: 'file' })
    // A choice made in the environment still wins.
    expect(providerAdapter('cursor').extendEnvironment!({ AGENT_CLI_CREDENTIAL_STORE: 'memory' }, ctx)).toMatchObject({
      AGENT_CLI_CREDENTIAL_STORE: 'memory',
    })
  })

  it('only offers terminal login and self-update where the CLI supports them', () => {
    expect(Object.fromEntries(AGENT_PROVIDERS.map((id) => [id, providerAdapter(id).loginArgs]))).toEqual({
      'claude-code': ['auth', 'login'],
      codex: ['login'],
      opencode: ['auth', 'login'],
      // Cursor signs in through its SDK's browser login, not the CLI.
      cursor: null,
      antigravity: null,
    })
    for (const id of ['antigravity', 'cursor'] as const) expect(providerAdapter(id).signIn).toBeTypeOf('function')
    for (const id of AGENT_PROVIDERS.filter((id) => id !== 'antigravity' && id !== 'cursor'))
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
  })

  it('has no terminal login for Antigravity or Cursor', () => {
    expect(service('/b/tool').loginCommand('antigravity')).toBeNull()
    expect(service('/b/tool').loginCommand('cursor')).toBeNull()
  })

  it('refuses in-app sign-in for providers that use the terminal command', async () => {
    await expect(service('/b/tool').signIn('codex')).rejects.toThrow('Use the Login command for this provider.')
  })
})

describe('Antigravity sign-in methods', () => {
  const signIn = providerAdapter('antigravity').signIn!
  const home = () => mkdtempSync(join(tmpdir(), 'ramu-agy-'))

  it('asks for what each method needs before starting the runtime', () => {
    expect(antigravitySignInProblem({ method: 'oauth-personal' })).toBeNull()
    expect(antigravitySignInProblem({ method: 'oauth-business', gcpProject: 'p' })).toMatch(/location/)
    expect(antigravitySignInProblem({ method: 'gemini-api-key' })).toMatch(/API key/)
    expect(antigravitySignInProblem({ method: 'gemini-api-key' }, true)).toBeNull()
    expect(antigravitySignInProblem({ method: 'agent-platform', gcpProject: 'p', gcpLocation: 'l' })).toBeNull()
    expect(antigravityKeyName('agent-platform')).toBe('GOOGLE_API_KEY')
  })

  it('records the method and Google Cloud project for the runtime, and authenticates with that method', async () => {
    const dir = home()
    try {
      const calls: string[] = []
      await signIn({
        installed: true,
        accountId: 'work',
        env: { GEMINI_HOME: dir },
        acpSignIn: async (_provider, method, account) => void calls.push(`${method}:${account}`),
        method: { method: 'oauth-business', gcpProject: 'acme-ai', gcpLocation: 'us-central1' },
      })
      expect(calls).toEqual(['oauth-business:work'])
      expect(JSON.parse(readFileSync(join(dir, 'antigravity-acp', 'settings.json'), 'utf8'))).toEqual({
        auth: { type: 'oauth-business' },
        gcp: { project: 'acme-ai', location: 'us-central1' },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves the previous sign-in in place when the runtime refuses the new one', async () => {
    const dir = home()
    try {
      mkdirSync(join(dir, 'antigravity-acp'), { recursive: true })
      writeFileSync(join(dir, 'antigravity-acp', 'settings.json'), '{"auth":{"type":"oauth-personal"}}')
      await expect(
        signIn({
          installed: true,
          accountId: 'default',
          env: { GEMINI_HOME: dir, GEMINI_API_KEY: 'k' },
          acpSignIn: async () => {
            throw new Error('Invalid API key')
          },
          method: { method: 'gemini-api-key' },
        }),
      ).rejects.toThrow('Invalid API key')
      expect(readFileSync(join(dir, 'antigravity-acp', 'settings.json'), 'utf8')).toContain('oauth-personal')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(process.platform === 'win32')('Codex API key sign-in', () => {
  it('hands the key to Codex on stdin, never in its arguments, and logs out to remove it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ramu-codex-key-'))
    try {
      const log = join(dir, 'log')
      const binary = join(dir, 'codex')
      writeFileSync(binary, `#!/bin/sh\necho "args:$*" >> "${log}"\ncat >> "${log}"\n`, { mode: 0o755 })
      const adapter = providerAdapter('codex')
      await adapter.storeApiKey!({ binary, env: process.env, key: 'sk-proj-secret' })
      await adapter.storeApiKey!({ binary, env: process.env, key: null })
      const lines = readFileSync(log, 'utf8').trim().split('\n')
      expect(lines).toEqual(['args:login --with-api-key', 'sk-proj-secret', 'args:logout'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
