import { statSync } from 'node:fs'
import {
  evaluateCompatibility,
  type CompatibilityPolicy,
  type CompatibilityResult,
  type RuntimeKind,
} from '@ramu/shared/providers/compatibility'
import { providerName, type ProviderConfiguration } from '@ramu/shared/providers/providers'
import type { AgentProvider } from '@ramu/shared/types'
import { providerAdapter } from './adapters'
import { COMPATIBILITY_POLICY, COMPATIBILITY_RUNTIME } from './compatibilityPolicy'
import { findExecutable, providerBinary, providerEnvironment } from './providerBinaries'

/** A launch refused because the runtime is proven incompatible with this Ramu release. Only that launch is blocked. */
export class ProviderIncompatibleError extends Error {
  readonly code = 'provider_incompatible'
  constructor(
    readonly provider: AgentProvider,
    readonly result: CompatibilityResult,
  ) {
    super(incompatibleMessage(provider, result))
  }
}

export function incompatibleMessage(provider: AgentProvider, result: CompatibilityResult): string {
  const affects = result.affects?.length ? ` It affects ${result.affects.join(', ')}.` : ''
  const fix = result.recommend
    ? ` Update to ${result.recommend} or newer in Settings → Providers, or change the executable path, then send again.`
    : ' Update it or change the executable path in Settings → Providers, then send again.'
  return `${providerName(provider)} ${result.observedVersion ?? ''} is not compatible with this Ramu release.${affects}${fix}`.replace(
    /\s{2,}/g,
    ' ',
  )
}

interface Entry {
  at: number
  result: CompatibilityResult
}

const FRESH_MS = 5 * 60_000
const MAX_ENTRIES = 32

type Probe = (provider: AgentProvider, binary: string, config?: ProviderConfiguration) => Promise<string | null>
type Locate = (provider: AgentProvider, config?: ProviderConfiguration) => string | null

/**
 * Compatibility decisions for the runtime Ramu actually launches, cached by executable identity (path, size, mtime,
 * inode: replacing a binary at the same path changes it) plus the policy revision. Probes are bounded version reads
 * with no model calls, coalesced per identity. A decision only ever blocks a proven incompatibility; an unverified
 * runtime, a failed probe or a missing rule stays launchable and normal protocol validation applies.
 */
export class LaunchCompatibility {
  private readonly entries = new Map<string, Entry>()
  private readonly inflight = new Map<string, Promise<CompatibilityResult>>()
  constructor(
    private readonly policy: CompatibilityPolicy = COMPATIBILITY_POLICY,
    private readonly runtimes: Partial<Record<AgentProvider, RuntimeKind>> = COMPATIBILITY_RUNTIME,
    private probe: Probe = (provider, binary, config) =>
      providerAdapter(provider).probeVersion(binary, providerEnvironment(provider, config)),
    private readonly locate: Locate = (provider, config) => findExecutable(providerBinary(provider, config)),
  ) {}

  /** Replaces how versions are read. For tests, which must not run a real provider executable. */
  useProbe(probe: Probe): void {
    this.probe = probe
    this.entries.clear()
    this.inflight.clear()
  }

  /** The runtime kind to evaluate, only when this policy has at least one rule for the provider. */
  private audited(provider: AgentProvider): RuntimeKind | null {
    const runtime = this.runtimes[provider]
    return runtime && this.policy.rules.some((rule) => rule.provider === provider && rule.runtime === runtime)
      ? runtime
      : null
  }

  /**
   * Whether a launch needs the asynchronous check at all: only a rule that declares a version incompatible can block it,
   * so a provider whose rules are all Supported or Limited starts without waiting for a version probe.
   */
  applies(provider: AgentProvider): boolean {
    const runtime = this.audited(provider)
    return (
      runtime !== null &&
      this.policy.rules.some(
        (rule) => rule.provider === provider && rule.runtime === runtime && rule.status === 'incompatible',
      )
    )
  }

  private identity(provider: AgentProvider, path: string): string {
    let stamp = 'missing'
    try {
      const stat = statSync(path)
      stamp = `${stat.size}:${stat.mtimeMs}:${stat.ino}`
    } catch {}
    return `${provider}|${path}|${stamp}|r${this.policy.revision}`
  }

  private store(key: string, result: CompatibilityResult) {
    this.entries.delete(key)
    this.entries.set(key, { at: Date.now(), result })
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!)
  }

  private decide(provider: AgentProvider, runtime: RuntimeKind, version: string | null): CompatibilityResult {
    return {
      ...evaluateCompatibility(this.policy, provider, runtime, version),
      checkedAt: new Date().toISOString(),
    }
  }

  /** Evaluates a version a status refresh already probed, and remembers it for the launch boundary. */
  observe(provider: AgentProvider, binary: string, version: string | null): CompatibilityResult | null {
    const runtime = this.runtimes[provider]
    if (!runtime) return null
    const result = this.decide(provider, runtime, version)
    if (this.audited(provider)) this.store(this.identity(provider, findExecutable(binary) ?? binary), result)
    return result
  }

  /** The cached decision for the executable that would launch now; null when none exists or the binary changed. */
  peek(provider: AgentProvider, config?: ProviderConfiguration): CompatibilityResult | null {
    if (!this.audited(provider)) return null
    const path = this.locate(provider, config)
    return path ? (this.entries.get(this.identity(provider, path))?.result ?? null) : null
  }

  /** The decision for the launching runtime, probing at most once per identity at a time. Null when not applicable. */
  async evaluate(provider: AgentProvider, config?: ProviderConfiguration): Promise<CompatibilityResult | null> {
    const runtime = this.audited(provider)
    if (!runtime) return null
    const path = this.locate(provider, config)
    if (!path) return null
    const key = this.identity(provider, path)
    const hit = this.entries.get(key)
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.result
    let pending = this.inflight.get(key)
    if (!pending) {
      pending = this.probe(provider, path, config)
        .catch(() => null)
        .then((version) => {
          const result = this.decide(provider, runtime, version)
          this.store(key, result)
          return result
        })
        .finally(() => this.inflight.delete(key))
      this.inflight.set(key, pending)
    }
    return pending
  }

  /** Forget cached decisions after a path change, managed-runtime activation or update. */
  invalidate(provider?: AgentProvider) {
    for (const key of [...this.entries.keys()])
      if (!provider || key.startsWith(`${provider}|`)) this.entries.delete(key)
  }

  /** Evaluates a release that is not installed yet, for update recommendations and auto-update. */
  target(provider: AgentProvider, version: string | null): CompatibilityResult | null {
    const runtime = this.audited(provider)
    return runtime && version ? evaluateCompatibility(this.policy, provider, runtime, version) : null
  }

  /** Throws only for a proven incompatibility. */
  async assertLaunchable(provider: AgentProvider): Promise<void> {
    const result = await this.evaluate(provider)
    if (result?.status === 'incompatible') throw new ProviderIncompatibleError(provider, result)
  }

  /** Whether the cached decision proves the provider cannot launch; unknown or uncached is not blocked. */
  isBlocked(provider: AgentProvider): boolean {
    return this.peek(provider)?.status === 'incompatible'
  }

  /** Providers automatic routing must skip. Unknown versions and probe failures stay eligible. */
  async blockedProviders(providers: readonly AgentProvider[]): Promise<Set<AgentProvider>> {
    const blocked = new Set<AgentProvider>()
    await Promise.all(
      providers.map(async (provider) => {
        if ((await this.evaluate(provider).catch(() => null))?.status === 'incompatible') blocked.add(provider)
      }),
    )
    return blocked
  }
}

export const launchCompatibility = new LaunchCompatibility()
