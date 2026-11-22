import type { AgentProvider } from './types/agent'

// Which browser an agent controls, and where clicked links open, are independent choices. The first is a host
// execution setting resolved per provider; the second is a device preference. Profiles are website identities, never
// provider accounts. Nothing here starts a browser or reads a cookie.

export type BrowserBackend = 'integrated' | 'provider'
export type BrowserChoice = 'default' | BrowserBackend
export type LinkTarget = 'system' | 'integrated'

export const DEFAULT_PROFILE_ID = 'default'
export const TEMPORARY_PROFILE_ID = 'temporary'

/** Host execution settings. Absent fields mean the defaults below. */
export interface AgentBrowserPreferences {
  /** Used by every provider without its own choice. */
  agentBrowser: BrowserBackend
  /** Per provider; missing means "Use default". */
  providerOverrides: Partial<Record<AgentProvider, BrowserBackend>>
  /** Profile new integrated tabs open in. */
  defaultProfileId: string
}

/** What a provider's adapter can actually do; reported by the adapter, never assumed. */
export interface ProviderBrowserCapability {
  /** Can use Ramu's browser tool family over its MCP connection. */
  integratedTools: boolean
  /** Has native browser tools Ramu can leave in place. */
  providerBrowser: boolean
  /** Native browser tools can be switched off for a session, so the chosen toolset is the only one. */
  canSuppressNative: boolean
}

/** Whether the selected host's integrated runtime can run now. */
export type RuntimeReadiness =
  { state: 'ready' } | { state: 'missing'; reason: string } | { state: 'unavailable'; reason: string }

export const DEFAULT_AGENT_BROWSER_PREFERENCES: AgentBrowserPreferences = {
  agentBrowser: 'integrated',
  providerOverrides: {},
  defaultProfileId: DEFAULT_PROFILE_ID,
}

export type BrowserResolution = {
  backend: BrowserBackend | null
  status: 'ready' | 'needs-setup' | 'unsupported'
  /** Where the answer came from, for details. */
  source: 'provider-override' | 'host-default'
  /** Plain-language reason when not ready; never a silent switch to the other backend. */
  reason?: string
  /** The chosen backend cannot hide the provider's native tools, so exclusivity is not guaranteed. */
  nativeToolsRemain?: boolean
}

/**
 * Provider override, then host default. A backend that cannot run is reported with its reason and its fix; it is never
 * quietly replaced by the other one, because that would change which sessions and logins the agent uses.
 */
export function resolveAgentBrowser(
  preferences: AgentBrowserPreferences,
  provider: AgentProvider,
  capability: ProviderBrowserCapability,
  runtime: RuntimeReadiness,
): BrowserResolution {
  const override = preferences.providerOverrides[provider]
  const backend = override ?? preferences.agentBrowser
  const source = override ? 'provider-override' : 'host-default'
  if (backend === 'provider') {
    return capability.providerBrowser
      ? { backend, status: 'ready', source }
      : { backend, status: 'unsupported', source, reason: 'This provider has no browser tools of its own to use.' }
  }
  if (!capability.integratedTools)
    return {
      backend,
      status: 'unsupported',
      source,
      reason: 'This provider cannot use Ramu’s browser tools reliably.',
    }
  if (runtime.state !== 'ready') return { backend, status: 'needs-setup', source, reason: runtime.reason }
  return { backend, status: 'ready', source, ...(capability.canSuppressNative ? {} : { nativeToolsRemain: true }) }
}

/** Opaque profile ids only: lowercase letters, digits and dashes, bounded, never a path or a name. */
export const validProfileId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)

export const isBuiltInProfile = (id: string) => id === DEFAULT_PROFILE_ID || id === TEMPORARY_PROFILE_ID

/**
 * Picks the profile a new tab uses. An unknown or deleted selection falls back to Default and says so, rather than
 * opening the tab in a profile the person did not choose.
 */
export function resolveProfile(
  selected: string | undefined,
  known: readonly string[],
): { id: string; fellBack: boolean } {
  if (selected && validProfileId(selected) && (isBuiltInProfile(selected) || known.includes(selected)))
    return { id: selected, fellBack: false }
  return { id: DEFAULT_PROFILE_ID, fellBack: selected !== undefined && selected !== DEFAULT_PROFILE_ID }
}

/** A run keeps the browser it started with; settings changes apply to the next run. */
export function freezeForRun(resolution: BrowserResolution, profileId: string) {
  return Object.freeze({ backend: resolution.backend, profileId })
}

/** Switching providers mid-run keeps the integrated session; a provider-private browser cannot move. */
export function fallbackKeepsBrowser(
  frozen: { backend: BrowserBackend | null },
  destination: BrowserResolution,
): boolean {
  return frozen.backend === 'integrated' && destination.backend === 'integrated' && destination.status === 'ready'
}
