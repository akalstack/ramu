import type {
  AgentModel,
  AgentProvider,
  AgentSettings,
  FallbackStep,
  ProviderCatalog,
  ReasoningEffort,
  SubagentPreferences,
  SwitchThreshold,
  UsageReading,
} from '../types'
import { providerName, providerAccountOrder, type ProviderConfiguration } from './providers'
import { usageAppliesTo } from '@ramu/shared/providers/usageScope'

// One place decides where a chat or sub-agent continues when a provider's plan is nearly used up.
// The main process uses it to switch before sending; the composer chip uses it to show where the next message will go.

/** A reading with no reset time is trusted this long; providers only report while they run. */
export const READING_TTL_MS = 15 * 60_000
const EFFORT_ORDER: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

export const stepKey = (step: { provider: AgentProvider; model: string }) => `${step.provider}:${step.model}`

/** The order used when none is configured: Claude Code, then Codex, each on its default model and effort. */
export function defaultOrder(catalogs: ProviderCatalog[]): FallbackStep[] {
  return (['claude-code', 'codex'] as const).map((provider) => {
    const model = catalogs.find((catalog) => catalog.provider === provider)?.models.find((entry) => entry.isDefault)
    return {
      id: `default-${provider}`,
      provider,
      model: model?.id ?? '',
      effort: model?.defaultEffort ?? null,
      serviceTier: 'standard',
    }
  })
}

/** Usage only goes down when a window resets, so a reading stays true until then. Without a reset time it ages out. */
export function readingCounts(reading: UsageReading, now: number): boolean {
  if (reading.resetsAt) return reading.resetsAt > now
  return now - reading.updatedAt < READING_TTL_MS
}

/** The fullest window that applies to this provider and model, or undefined when nothing is known. */
export function peakFor(
  usage: UsageReading[],
  provider: AgentProvider,
  model: string,
  now = Date.now(),
): UsageReading | undefined {
  return usage
    .filter((reading) => reading.provider === provider && usageAppliesTo(reading, model) && readingCounts(reading, now))
    .sort(
      (a, b) => (b.status === 'limited' ? 1 : 0) - (a.status === 'limited' ? 1 : 0) || b.usedPercent - a.usedPercent,
    )[0]
}

export function isOver(reading: UsageReading | undefined, switchAt: SwitchThreshold): boolean {
  return !!reading && (reading.status === 'limited' || (switchAt !== null && reading.usedPercent >= switchAt))
}

export function nearestEffort(wanted: ReasoningEffort | null, model: AgentModel): ReasoningEffort | null {
  if (!model.efforts.length) return null
  if (!wanted) return model.defaultEffort
  if (model.efforts.includes(wanted)) return wanted
  const at = EFFORT_ORDER.indexOf(wanted)
  return (
    [...model.efforts].sort(
      (a, b) =>
        Math.abs(EFFORT_ORDER.indexOf(a) - at) - Math.abs(EFFORT_ORDER.indexOf(b) - at) ||
        EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b),
    )[0] ?? model.defaultEffort
  )
}

/** Fills in the default model and maps the effort onto what the model supports; null when the model is not available. */
export function resolveStep(step: FallbackStep, catalogs: ProviderCatalog[]): FallbackStep | null {
  const models = catalogs.find((catalog) => catalog.provider === step.provider)?.models ?? []
  const model =
    models.find((entry) => (step.model ? entry.id === step.model : entry.isDefault)) ??
    (step.model ? undefined : models[0])
  if (!model) return null
  const fast = model.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
  return {
    ...step,
    model: model.id,
    effort: nearestEffort(step.effort, model),
    serviceTier: fast ? (step.serviceTier ?? 'standard') : 'standard',
  }
}

export interface RouteContext {
  usage: UsageReading[]
  catalogs: ProviderCatalog[]
  switchAt: SwitchThreshold
  now?: number
  /** Steps already used for this chat, as `provider:model`. */
  attempted?: ReadonlySet<string>
  /** All enabled logins and their readings, before considering a different model. */
  accounts?: { configuration: ProviderConfiguration; usage: UsageReading[] }
  attemptedAccounts?: ReadonlySet<string>
}

/** The first chain entry that is available, not tried yet and under the threshold. */
export function nextStep(chain: FallbackStep[], context: RouteContext): (FallbackStep & { accountId?: string }) | null {
  const now = context.now ?? Date.now()
  for (const entry of chain) {
    const step = resolveStep(entry, context.catalogs)
    if (!step || context.attempted?.has(stepKey(step))) continue
    if (context.accounts) {
      for (const accountId of providerAccountOrder(context.accounts.configuration, step.provider)) {
        const usage = context.accounts.usage.filter((reading) => (reading.accountId ?? 'default') === accountId)
        if (!isOver(peakFor(usage, step.provider, step.model, now), context.switchAt)) return { ...step, accountId }
      }
      continue
    }
    if (isOver(peakFor(context.usage, step.provider, step.model, now), context.switchAt)) continue
    return step
  }
  return null
}

/** The usage reading that requires switching models. */
export interface RouteDecision {
  step: FallbackStep & { accountId?: string }
  reason: string
  peak: UsageReading
}

export function windowName(reading: UsageReading): string {
  const base =
    reading.window === 'five_hour'
      ? '5-hour'
      : reading.window === 'monthly'
        ? 'monthly'
        : reading.window === 'quota'
          ? 'quota'
          : 'weekly'
  return reading.scope ? `${reading.scope} ${base}` : base
}

export function limitReason(provider: AgentProvider, peak: UsageReading): string {
  const reset = peak.resetsAt
    ? ` (resets ${new Date(peak.resetsAt).toLocaleString(undefined, peak.resetsAt - Date.now() > 20 * 3600_000 ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })})`
    : ''
  return `${providerName(provider)}'s ${windowName(peak)} limit ${peak.status === 'limited' ? 'was reached' : `was at ${peak.usedPercent}%`}${reset}`
}

/** Switch only when the current model reaches the usage threshold and another entry has room. */
export function planRoute(
  settings: Pick<AgentSettings, 'provider' | 'model' | 'autoFallback'> &
    Partial<Pick<AgentSettings, 'accountId' | 'effort' | 'serviceTier'>>,
  order: FallbackStep[],
  context: RouteContext,
): RouteDecision | null {
  if (!settings.autoFallback) return null
  // An empty model means the provider's default: look up which model that is, so model-specific windows and attempts match.
  const model =
    resolveStep({ id: '', provider: settings.provider, model: settings.model, effort: null }, context.catalogs)
      ?.model ?? settings.model
  const current = stepKey({ provider: settings.provider, model })
  const attempted = new Set(context.attempted ?? [])
  attempted.add(stepKey(settings))
  attempted.add(current)
  const accountId =
    settings.accountId ??
    (context.accounts ? providerAccountOrder(context.accounts.configuration, settings.provider)[0] : undefined) ??
    'default'
  const usage = context.accounts
    ? context.accounts.usage.filter((reading) => (reading.accountId ?? 'default') === accountId)
    : context.usage
  const peak = peakFor(usage, settings.provider, model, context.now)
  if (peak && isOver(peak, context.switchAt)) {
    if (context.accounts) {
      const next = nextAccount(
        { ...settings, accountId },
        providerAccountOrder(context.accounts.configuration, settings.provider),
        { ...context, usage: context.accounts.usage, attempted: context.attemptedAccounts },
      )
      if (next)
        return {
          step: {
            id: '',
            provider: settings.provider,
            model,
            effort: settings.effort ?? null,
            serviceTier: settings.serviceTier,
            accountId: next,
          },
          peak,
          reason: limitReason(settings.provider, peak),
        }
    }
    const step = nextStep(order, { ...context, attempted })
    return step ? { step, peak, reason: limitReason(settings.provider, peak) } : null
  }
  return null
}

/** `provider:model` for a chat's settings, with the provider's default model filled in. */
export function settingsKey(settings: Pick<AgentSettings, 'provider' | 'model'>, catalogs: ProviderCatalog[]): string {
  return stepKey({
    provider: settings.provider,
    model:
      resolveStep({ id: '', provider: settings.provider, model: settings.model, effort: null }, catalogs)?.model ??
      settings.model,
  })
}

/** A sub-agent's order: its own when configured as separate, else the main order. */
export function subagentOrder(prefs: SubagentPreferences, mainOrder: FallbackStep[]): FallbackStep[] {
  return prefs.fallback === 'separate' ? (prefs.order ?? mainOrder) : mainOrder
}

/**
 * Which step a new sub-agent should use, or null for the provider's native sub-agents.
 * Type rules win over the mode; a rule or mode that says native keeps native.
 */
export function subagentTarget(
  prefs: SubagentPreferences,
  parentProvider: AgentProvider,
  type: string | undefined,
): FallbackStep | null {
  const rule = type
    ? prefs.byType.find((entry) => entry.type.trim() && entry.type.trim().toLowerCase() === type.trim().toLowerCase())
    : undefined
  if (rule) return rule.step
  if (prefs.mode === 'single') return prefs.single
  if (prefs.mode === 'per-provider') return prefs.perProvider[parentProvider] ?? null
  return null
}

export const accountKey = (provider: AgentProvider, accountId: string | undefined) =>
  `${provider}:${accountId || 'default'}`

/**
 * The next login of the same provider to continue on: the first of `accounts` that is not the chat's own, not tried yet
 * and under the threshold. `usage` holds readings for every account; an account with no reading is assumed to have room.
 */
export function nextAccount(
  settings: Pick<AgentSettings, 'provider' | 'model' | 'accountId'>,
  accounts: string[],
  context: {
    usage: UsageReading[]
    catalogs: ProviderCatalog[]
    switchAt: SwitchThreshold
    now?: number
    attempted?: ReadonlySet<string>
  },
): string | null {
  const model =
    resolveStep({ id: '', provider: settings.provider, model: settings.model, effort: null }, context.catalogs)
      ?.model ?? settings.model
  const current = settings.accountId || 'default'
  for (const account of accounts) {
    if (account === current || context.attempted?.has(accountKey(settings.provider, account))) continue
    const readings = context.usage.filter((reading) => (reading.accountId ?? 'default') === account)
    if (isOver(peakFor(readings, settings.provider, model, context.now), context.switchAt)) continue
    return account
  }
  return null
}

/** Apply both sub-agent caps without rounding above either ceiling. */
export function capSubagentEffort(
  settings: AgentSettings,
  prefs: SubagentPreferences,
  catalogs: ProviderCatalog[],
): AgentSettings {
  const model = catalogs
    .find((c) => c.provider === settings.provider)
    ?.models.find((m) => (settings.model ? m.id === settings.model : m.isDefault))
  if (!model) return settings
  const caps = [
    prefs.maxEffort,
    prefs.modelMaxEffort?.[stepKey({ provider: settings.provider, model: model.id })],
  ].filter((e): e is ReasoningEffort => !!e)
  if (!caps.length) return settings
  const ceiling = Math.min(...caps.map((e) => EFFORT_ORDER.indexOf(e)))
  const wanted = nearestEffort(settings.effort, model)
  if (wanted === null || EFFORT_ORDER.indexOf(wanted) <= ceiling) return { ...settings, effort: wanted }
  const effort = [...model.efforts]
    .filter((e) => EFFORT_ORDER.indexOf(e) <= ceiling)
    .sort((a, b) => EFFORT_ORDER.indexOf(b) - EFFORT_ORDER.indexOf(a))[0]
  if (!effort) throw new Error(`No supported effort for ${model.id} is within the sub-agent effort cap.`)
  return { ...settings, effort }
}
