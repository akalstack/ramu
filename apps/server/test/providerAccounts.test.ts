import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { configureProviderAccounts, providerEnvironment } from '../src/providerBinaries'

it('points every provider at its own account directory and drops shared credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-accounts-'))
  configureProviderAccounts(root)
  const config = Object.fromEntries((['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as const).map((provider) => [provider, { binary: '', accounts: [{ id: 'work', name: 'Work' }] }]))
  process.env.ANTHROPIC_API_KEY = 'secret'
  try {
    const claude = providerEnvironment('claude-code', config, 'work')
    expect(claude.CLAUDE_CONFIG_DIR).toBe(join(root, 'claude-code', 'work'))
    expect(claude.ANTHROPIC_API_KEY).toBeUndefined()
    expect(providerEnvironment('antigravity', config, 'work').GEMINI_HOME).toBe(join(root, 'antigravity', 'work'))
    expect(providerEnvironment('cursor', config, 'work')).toMatchObject({ CURSOR_CONFIG_DIR: join(root, 'cursor', 'work'), AGENT_CLI_CREDENTIAL_STORE: 'file' })
    expect(providerEnvironment('claude-code', config, 'default').CLAUDE_CONFIG_DIR).toBe(process.env.CLAUDE_CONFIG_DIR)
  } finally { delete process.env.ANTHROPIC_API_KEY }
})
