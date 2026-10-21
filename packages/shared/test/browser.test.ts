import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_BROWSER_PREFERENCES,
  fallbackKeepsBrowser,
  freezeForRun,
  migrateAgentBrowserPreferences,
  resolveAgentBrowser,
  resolveProfile,
  validProfileId,
  type ProviderBrowserCapability,
} from '../src/browser'

const full: ProviderBrowserCapability = { integratedTools: true, providerBrowser: true, canSuppressNative: true }
const ready = { state: 'ready' } as const

describe('agent browser resolution', () => {
  it('uses the provider override, then the host default', () => {
    const prefs = { ...DEFAULT_AGENT_BROWSER_PREFERENCES, providerOverrides: { codex: 'provider' as const } }
    expect(resolveAgentBrowser(prefs, 'codex', full, ready)).toMatchObject({
      backend: 'provider',
      source: 'provider-override',
    })
    expect(resolveAgentBrowser(prefs, 'claude-code', full, ready)).toMatchObject({
      backend: 'integrated',
      source: 'host-default',
      status: 'ready',
    })
  })

  it('reports a missing runtime as setup, and never switches to the provider browser on its own', () => {
    const out = resolveAgentBrowser(DEFAULT_AGENT_BROWSER_PREFERENCES, 'codex', full, {
      state: 'missing',
      reason: 'Install the browser runtime on this host.',
    })
    expect(out).toMatchObject({
      backend: 'integrated',
      status: 'needs-setup',
      reason: 'Install the browser runtime on this host.',
    })
  })

  it('marks unsupported choices with a reason instead of falling back', () => {
    const none = { integratedTools: false, providerBrowser: false, canSuppressNative: false }
    expect(resolveAgentBrowser(DEFAULT_AGENT_BROWSER_PREFERENCES, 'cursor', none, ready)).toMatchObject({
      status: 'unsupported',
      backend: 'integrated',
    })
    expect(
      resolveAgentBrowser({ ...DEFAULT_AGENT_BROWSER_PREFERENCES, agentBrowser: 'provider' }, 'cursor', none, ready),
    ).toMatchObject({ status: 'unsupported', backend: 'provider' })
  })

  it('does not promise exclusivity when native browser tools cannot be suppressed', () => {
    const noSuppress = { ...full, canSuppressNative: false }
    expect(resolveAgentBrowser(DEFAULT_AGENT_BROWSER_PREFERENCES, 'codex', noSuppress, ready).nativeToolsRemain).toBe(
      true,
    )
    expect(
      resolveAgentBrowser(DEFAULT_AGENT_BROWSER_PREFERENCES, 'codex', full, ready).nativeToolsRemain,
    ).toBeUndefined()
  })
})

describe('profiles', () => {
  it('accepts only opaque ids', () => {
    for (const bad of ['', 'A', '../x', 'a/b', 'a b', 'x'.repeat(65), 7, null]) expect(validProfileId(bad)).toBe(false)
    expect(validProfileId('work-2')).toBe(true)
  })
  it('falls back to Default visibly when the chosen profile is gone', () => {
    expect(resolveProfile('work', ['work'])).toEqual({ id: 'work', fellBack: false })
    expect(resolveProfile('work', [])).toEqual({ id: 'default', fellBack: true })
    expect(resolveProfile('temporary', [])).toEqual({ id: 'temporary', fellBack: false })
    expect(resolveProfile(undefined, [])).toEqual({ id: 'default', fellBack: false })
    expect(resolveProfile('../etc', ['../etc'])).toEqual({ id: 'default', fellBack: true })
  })
})

describe('migration and runs', () => {
  it('keeps an existing provider browser, defaults everyone else and preserves explicit choices', () => {
    const migrated = migrateAgentBrowserPreferences(['codex', 'cursor'], {
      providerOverrides: { cursor: 'integrated' },
    })
    expect(migrated.providerOverrides).toEqual({ codex: 'provider', cursor: 'integrated' })
    expect(migrated.agentBrowser).toBe('integrated')
    expect(migrateAgentBrowserPreferences([], undefined)).toEqual(DEFAULT_AGENT_BROWSER_PREFERENCES)
    expect(migrateAgentBrowserPreferences([], { defaultProfileId: '../bad' }).defaultProfileId).toBe('default')
  })

  it('freezes a run, and only an integrated destination keeps the session on fallback', () => {
    const integrated = resolveAgentBrowser(DEFAULT_AGENT_BROWSER_PREFERENCES, 'codex', full, ready)
    const frozen = freezeForRun(integrated, 'work')
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(fallbackKeepsBrowser(frozen, integrated)).toBe(true)
    const providerSide = resolveAgentBrowser(
      { ...DEFAULT_AGENT_BROWSER_PREFERENCES, agentBrowser: 'provider' },
      'codex',
      full,
      ready,
    )
    expect(fallbackKeepsBrowser(frozen, providerSide)).toBe(false)
    expect(fallbackKeepsBrowser(freezeForRun(providerSide, 'default'), integrated)).toBe(false)
  })
})
