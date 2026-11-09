import type { Ability, AbilityCheck } from '@ramu/shared/providers/abilities'
import { providerEnabled, type ProviderConfiguration } from '@ramu/shared/providers/providers'
import type { AgentModel, AgentProvider } from '@ramu/shared/types'
import type { AbilityDeclaration } from './adapter'
import { providerAdapter } from './adapters'
import { findExecutable, providerAccountId, providerBinary, providerEnvironment } from './providerBinaries'
import { signInState } from './providers'

/**
 * A check as stored: the login identity it ran under stays on the host and is never returned, and so do the costs its
 * calls reported, which the list shows as their middle value.
 */
type Stored = Omit<AbilityCheck, 'typicalCostUsd'> & { login: string; costs?: number[] }

/** Reported costs kept per check, newest last. */
const KEPT_COSTS = 20

const middle = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2
}

/** One check: run the ability once with the smallest request that proves it, and say whether it worked. */
export type AbilityProbe = (
  target: { provider: AgentProvider; accountId: string; model: string; declaration: AbilityDeclaration },
  signal: AbortSignal,
) => Promise<{
  ok: boolean
  detail?: string
  /** The share of the check's sample tasks answered right. */
  score?: number
  /** What the provider reported the check cost. */
  costUsd?: number
}>

/** The login a check runs under: who is signed in and on which installed version. */
export interface AbilityLogin {
  provider: AgentProvider
  accountId: string
  version: string
  /** Changes when a different person or plan signs in, so the checks run again. */
  login: string
  /** The login uses an API key, billed per call. */
  apiKey: boolean
  models: readonly AgentModel[]
}

const MAX_STORED = 200

/** A provider's chosen login as the checks see it: installed version and who is signed in. Null when it cannot run. */
export async function providerLogin(
  provider: AgentProvider,
  config: ProviderConfiguration,
): Promise<Omit<AbilityLogin, 'models'> | null> {
  if (!providerEnabled(config, provider)) return null
  const binary = findExecutable(providerBinary(provider, config))
  if (!binary) return null
  const accountId = providerAccountId(provider)
  const env = providerEnvironment(provider, config, accountId)
  const version = await providerAdapter(provider)
    .probeVersion(binary, env)
    .catch(() => null)
  if (!version) return null
  const signIn = await signInState(provider, binary, env).catch(() => ({ signedIn: false }) as const)
  if (!signIn.signedIn) return null
  return {
    provider,
    accountId,
    version,
    login: [signIn.email, signIn.plan, signIn.apiKey ? 'key' : ''].join('|'),
    apiKey: !!signIn.apiKey,
  }
}

/**
 * The model a check and later calls use: the declared one, the largest window for long context, else the default.
 * Claude and Codex list models without their windows; then the default model runs and the check reads the window the
 * provider reports for that run.
 */
export function checkModel(declaration: AbilityDeclaration, models: readonly AgentModel[]): AgentModel | null {
  const current = models.filter((model) => !model.isLegacy)
  const fallback = current.find((model) => model.isDefault) ?? current[0] ?? null
  if ('contextWindow' in declaration.via) {
    const minimum = declaration.via.contextWindow
    if (!current.some((model) => model.contextWindow)) return fallback
    return (
      current
        .filter((model) => (model.contextWindow ?? 0) >= minimum)
        .sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))[0] ?? null
    )
  }
  if (declaration.models?.length) return current.find((model) => declaration.models!.includes(model.id)) ?? null
  return fallback
}

/**
 * Live ability checks, kept per provider login and installed version. Each declared ability is checked once for a
 * login, version and sign-in, with one small request; a failure is kept too, so a check never repeats until the
 * version or sign-in changes or the person asks for it again. Image editing is checked only after image generation
 * passed, since it needs the same tool.
 */
export class AbilityChecks {
  private readonly inflight = new Map<string, Promise<AbilityCheck[]>>()
  constructor(
    private readonly read: () => unknown,
    private readonly write: (checks: Stored[]) => void,
    private readonly probe: AbilityProbe,
    private readonly declarations: (provider: AgentProvider) => readonly AbilityDeclaration[] = (provider) =>
      providerAdapter(provider).native?.abilities ?? [],
  ) {}

  private stored(): Stored[] {
    const value = this.read()
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is Stored =>
            !!entry && typeof entry === 'object' && typeof entry.ability === 'string' && typeof entry.ok === 'boolean',
        )
      : []
  }

  /** Every kept result, without the sign-in identity. */
  list(provider?: AgentProvider): AbilityCheck[] {
    return this.stored()
      .filter((entry) => !provider || entry.provider === provider)
      .map(({ login: _login, costs, ...check }) =>
        costs?.length ? { ...check, typicalCostUsd: middle(costs) } : check,
      )
  }

  /** Keeps the cost a call reported on the current check of the login it ran on. */
  recordCost(provider: AgentProvider, accountId: string, ability: Ability, costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) return
    const stored = this.stored()
    // The newest check of that login is the current one; older versions' entries were dropped when it ran.
    const index = stored.findLastIndex(
      (entry) => entry.provider === provider && entry.accountId === accountId && entry.ability === ability,
    )
    const entry = stored[index]
    if (!entry) return
    stored[index] = { ...entry, costs: [...(entry.costs ?? []), costUsd].slice(-KEPT_COSTS) }
    this.write(stored)
  }

  running(): boolean {
    return this.inflight.size > 0
  }

  /** Runs the checks this login and version have not had yet. Coalesced per login. */
  ensure(target: AbilityLogin, signal: AbortSignal, force = false): Promise<AbilityCheck[]> {
    const key = `${target.provider}|${target.accountId}`
    const pending = this.inflight.get(key)
    if (pending) return pending
    const work = this.run(target, signal, force).finally(() => this.inflight.delete(key))
    this.inflight.set(key, work)
    return work
  }

  private async run(target: AbilityLogin, signal: AbortSignal, force: boolean): Promise<AbilityCheck[]> {
    const current = (entry: Stored) =>
      entry.provider === target.provider &&
      entry.accountId === target.accountId &&
      entry.version === target.version &&
      entry.login === target.login
    let kept = this.stored().filter(
      // Results for another version or sign-in of this login are stale; other logins keep theirs.
      (entry) => entry.provider !== target.provider || entry.accountId !== target.accountId || current(entry),
    )
    // A check that found no model made no request, so it runs again: the model list may have changed since.
    kept = kept.filter((entry) => !(current(entry) && (force || (!entry.ok && !entry.model))))
    const done = new Set(kept.filter(current).map((entry) => entry.ability))
    const results: Stored[] = []
    const passed = (ability: Ability) =>
      done.has(ability)
        ? kept.some((entry) => current(entry) && entry.ability === ability && entry.ok)
        : results.some((entry) => entry.ability === ability && entry.ok)
    for (const declaration of this.declarations(target.provider)) {
      if (signal.aborted) break
      if (done.has(declaration.ability)) continue
      const base = {
        ability: declaration.ability,
        provider: target.provider,
        accountId: target.accountId,
        version: target.version,
        login: target.login,
        checkedAt: new Date().toISOString(),
        ...(target.apiKey ? { apiKey: true } : {}),
      }
      const model = checkModel(declaration, target.models)
      if (!model) {
        results.push({
          ...base,
          model: '',
          ok: false,
          detail:
            'contextWindow' in declaration.via
              ? `No model on this login reports a context window of ${declaration.via.contextWindow.toLocaleString('en-US')} tokens or more.`
              : 'No model on this login offers it.',
        })
        continue
      }
      if (declaration.ability === 'image_edit' && !passed('image_generation')) {
        results.push({ ...base, model: model.id, ok: false, detail: 'Image generation did not pass its check.' })
        continue
      }
      try {
        const outcome = await this.probe(
          { provider: target.provider, accountId: target.accountId, model: model.id, declaration },
          signal,
        )
        results.push({
          ...base,
          model: model.id,
          ok: outcome.ok,
          ...(outcome.detail ? { detail: outcome.detail } : {}),
          ...(outcome.score === undefined ? {} : { score: outcome.score }),
          ...(outcome.costUsd === undefined ? {} : { costs: [outcome.costUsd] }),
        })
      } catch (error) {
        if (signal.aborted) break
        results.push({
          ...base,
          model: model.id,
          ok: false,
          detail: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        })
      }
    }
    this.write([...kept, ...results].slice(-MAX_STORED))
    return this.list(target.provider).filter(
      (entry) => entry.accountId === target.accountId && entry.version === target.version,
    )
  }
}
