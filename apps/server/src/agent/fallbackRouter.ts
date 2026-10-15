import { providerAccountId } from '../providers/providerBinaries'
import { providerName, supportsProviderAccounts, providerAccountOrder } from '@ramu/shared/providers'
import {
  DEFAULT_FALLBACK_PREFERENCES,
  type SwitchThreshold,
  type UsageReading,
  type FallbackStep,
  type AppPreferences,
  type AgentSessionInfo,
  type AgentSettings,
  type AgentProvider,
  type ProviderCatalog,
} from '@ramu/shared/types'
import {
  defaultOrder,
  resolveStep,
  subagentOrder,
  subagentTarget,
  settingsKey,
  isOver,
  limitReason,
  nextStep,
  nextAccount,
  accountKey,
  peakFor,
  planRoute,
  stepKey,
  type RouteDecision,
} from '@ramu/shared/routing'
import { WRITING_STATES } from './constants'
import { sameSettings } from './settings'
import type { CatalogService } from './catalogService'
import type { SessionProcess } from './sessionProcess'
import type { ProviderWaits } from './providerWait'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { SessionStore } from './sessionStore'
import type { SubagentRunner } from './subagentRunner'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** What FallbackRouter needs from the rest of the service. */
export interface FallbackRouterHost
  extends
    Pick<CatalogService, 'validateSettings'>,
    Pick<SessionProcess, 'fail' | 'halt' | 'launch'>,
    Pick<ProviderWaits, 'waitForGoalProvider'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<SessionRegistry, 'draining' | 'revisions' | 'transitioning'>,
    Pick<SessionStore, 'get'>,
    Pick<SubagentRunner, 'settleChild'> {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  preferences(): AppPreferences | undefined
  preferencesSource(): (() => AppPreferences) | undefined
  refreshAccountUsage(): AgentService['refreshAccountUsage']
  shutdown(): AgentService['shutdown']
  usage(): AgentService['usage']
}

/** Usage-limit fallback and account/model routing: where a chat or sub-agent should run, and moving it there. */
export class FallbackRouter {
  constructor(
    private readonly host: FallbackRouterHost,
    private readonly db: Db,
  ) {}

  // Set from the composer's provider chip. The pre-emptive switch (see docs/AGENTS.md) must honour it; 'message' clears after one send.
  private readonly holds = new Map<string, 'message' | 'chat'>()

  /** Chats whose model the user picked by hand: they don't move up the order until they next hit a limit. */
  private readonly pinned = new Set<string>()

  /** Steps (`provider:model`) a chat has already been through while falling back. */
  readonly attempted = new Map<string, Set<string>>()

  /** Logins of the chat's provider already tried since its last message, as `provider:account`. */
  readonly attemptedAccounts = new Map<string, Set<string>>()

  /** The user changed model, effort or access. A new model is pinned: it doesn't move up the order until it next runs out. */
  async configure(id: string, settings: AgentSettings): Promise<AgentSessionInfo> {
    const current = this.host.get(id).settings
    if (sameSettings(current, settings)) return this.host.get(id)
    if (stepKey(current) !== stepKey(settings)) this.pinned.add(id)
    this.holds.delete(id)
    return this.applySettings(id, settings)
  }

  /** Moves a chat to other settings (any provider): ends the old process, keeps or hands over the conversation, relaunches if it was mid-request. */
  private async applySettings(id: string, settings: AgentSettings, reason?: string): Promise<AgentSessionInfo> {
    if (this.host.transitioning.has(id)) throw new Error('Provider switch already in progress')
    const s = this.host.get(id)
    const accountId =
      settings.accountId ??
      (settings.provider === s.provider ? s.settings.accountId : providerAccountId(settings.provider))
    if (accountId && accountId !== 'default') settings = { ...settings, accountId }
    const sameIdentity =
      settings.provider === s.provider && (settings.accountId ?? 'default') === (s.settings.accountId ?? 'default')
    if (sameSettings(s.settings, settings)) return s
    const revision = this.host.revisions.get(id) ?? 0
    this.host.transitioning.add(id)
    try {
      await this.host.validateSettings(settings)
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0))
        throw new Error('Provider switch cancelled')
      // Terminate the old process before releasing its checkout or starting another provider.
      this.host.halt(id)
      await this.host.draining.get(id)
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0))
        throw new Error('Provider switch cancelled')
      this.db
        .prepare('UPDATE agent_sessions SET provider = ?, settings = ?, provider_session_id = ? WHERE id = ?')
        .run(settings.provider, JSON.stringify(settings), sameIdentity ? s.providerSessionId : null, id)
      this.host.record(id, {
        kind: 'settings',
        settings,
        reason:
          reason ??
          (WRITING_STATES.includes(s.state)
            ? 'Changed settings — continuing the current request'
            : 'Changed conversation settings'),
        handoff: !sameIdentity,
        previous: s.settings,
      })
      if (WRITING_STATES.includes(s.state)) {
        this.host.transitioning.delete(id)
        this.host.launch(
          id,
          'Continue the unfinished user request with the updated conversation settings. Check existing files and tool results before repeating any completed action.',
          sameIdentity ? s.providerSessionId : null,
          false,
        )
      } else this.host.setState(id, 'restored')
      return this.host.get(id)
    } finally {
      this.host.transitioning.delete(id)
      this.host.settleChild(id)
    }
  }

  /** Clearing the hold also lets a model the user picked by hand move up the order again. */
  holdProvider(id: string, scope: 'message' | 'chat' | null): void {
    if (scope) this.holds.set(id, scope)
    else {
      this.holds.delete(id)
      this.pinned.delete(id)
    }
  }

  providerHold(id: string): 'message' | 'chat' | 'picked' | null {
    return this.holds.get(id) ?? (this.pinned.has(id) ? 'picked' : null)
  }

  /** Preferences and usage, once the app has provided them; tests run without. */
  routing(settings?: AgentSettings): { prefs: AppPreferences; usage: UsageReading[]; all: UsageReading[] } | null {
    const source = this.host.preferencesSource()
    const usage = this.host.usage()
    if (!source || !usage) return null
    return {
      prefs: source(),
      usage: usage.list(settings ? { [settings.provider]: settings.accountId ?? 'default' } : {}),
      all: usage.all?.() ?? [],
    }
  }

  /** Another login of the same provider with room, when the user turned account rotation on for it; null otherwise. */
  private otherAccount(
    settings: AgentSettings,
    routing: { prefs: AppPreferences },
    catalogs: ProviderCatalog[],
    switchAt: SwitchThreshold,
    tried?: ReadonlySet<string>,
  ): string | null {
    if (!settings.autoFallback || !supportsProviderAccounts(settings.provider)) return null
    const accounts = providerAccountOrder(routing.prefs.providerBinaries, settings.provider)
    if (accounts.length < 2) return null
    return nextAccount(settings, accounts, {
      usage: this.host.usage()?.all?.() ?? [],
      catalogs,
      switchAt,
      attempted: tried,
    })
  }

  /** Waits briefly for a current reading of the provider's other logins; a slow read never holds up the chat. */
  private async freshAccountUsage(provider: AgentProvider): Promise<void> {
    const refresh = this.host.refreshAccountUsage()
    if (!refresh) return
    await Promise.race([
      refresh(provider).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 8_000).unref()),
    ])
  }

  private accountName(provider: AgentProvider, accountId: string | undefined): string {
    if (!accountId || accountId === 'default') return 'the default account'
    return `account "${this.host.preferences()?.providerBinaries[provider]?.accounts?.find((entry) => entry.id === accountId)?.name ?? accountId}"`
  }

  /** Fallback order and threshold for a session: a sub-agent may use its own order and an earlier threshold. */
  policyOf(
    s: Pick<AgentSessionInfo, 'parentId'>,
    catalogs: ProviderCatalog[],
    prefs?: AppPreferences,
  ): { order: FallbackStep[]; switchAt: SwitchThreshold } {
    const main = this.orderOf(catalogs, prefs)
    // null is the explicit "only at the limit" policy, not a missing preference.
    const switchAt = prefs ? prefs.fallback.switchAt : DEFAULT_FALLBACK_PREFERENCES.switchAt
    if (!s.parentId || !prefs) return { order: main, switchAt }
    return {
      order: subagentOrder(prefs.subagents, main),
      switchAt: prefs.subagents.switchAt === 'same' ? switchAt : prefs.subagents.switchAt,
    }
  }

  orderOf(catalogs: ProviderCatalog[], prefs?: AppPreferences): FallbackStep[] {
    return prefs?.fallback.order ?? defaultOrder(catalogs)
  }

  withStep(settings: AgentSettings, step: FallbackStep): AgentSettings {
    return {
      ...settings,
      accountId:
        step.provider === settings.provider ? (settings.accountId ?? 'default') : providerAccountId(step.provider),
      provider: step.provider,
      model: step.model,
      effort: step.effort,
      serviceTier: step.serviceTier ?? 'standard',
    }
  }

  /**
   * Where settings should go instead: on from a model at the switch threshold, or, with `promote`, up to a
   * higher-ranked model with room. Background work (titles, recaps, commit messages) keeps its model until it runs out.
   */
  async route(settings: AgentSettings, promote = false): Promise<RouteDecision | null> {
    const routing = this.routing(settings)
    if (!routing || !settings.autoFallback) return null
    const catalogs = await this.host.catalog()
    return planRoute(settings, this.orderOf(catalogs, routing.prefs), {
      usage: routing.usage,
      catalogs,
      switchAt: routing.prefs.fallback.switchAt,
      promote,
    })
  }

  /** Explains a switch made before a chat started. */
  noteRoute(id: string, from: AgentSettings, to: AgentSettings, reason: string): void {
    this.host.record(id, {
      kind: 'settings',
      settings: to,
      reason: `${reason} — continuing with ${providerName(to.provider)}`,
      handoff: false,
      previous: from,
    })
  }

  /**
   * Before a message goes out: move on if the chat's model is over the threshold, or up to a higher-ranked model
   * that has room. A hold from the composer chip keeps the model for one message or the chat; a model the user
   * picked by hand isn't moved up until it next runs out.
   */
  async switchBeforeSend(id: string): Promise<boolean> {
    const routing = this.routing(this.host.get(id).settings)
    if (!routing) return false
    const s = this.host.get(id)
    const catalogs = await this.host.catalog()
    const policy = this.policyOf(s, catalogs, routing.prefs)
    const promote = !s.parentId && !this.pinned.has(id)
    // Another login of the same provider comes before another model.
    if (!this.holds.has(id) && isOver(peakFor(routing.usage, s.settings.provider, s.settings.model), policy.switchAt)) {
      const tried = this.attemptedAccounts.get(id) ?? new Set<string>()
      tried.add(accountKey(s.settings.provider, s.settings.accountId))
      this.attemptedAccounts.set(id, tried)
      await this.freshAccountUsage(s.settings.provider)
      const account = this.otherAccount(s.settings, routing, catalogs, policy.switchAt, tried)
      if (account) {
        tried.add(accountKey(s.settings.provider, account))
        await this.applySettings(
          id,
          { ...s.settings, accountId: account },
          `${providerName(s.settings.provider)} on ${this.accountName(s.settings.provider, s.settings.accountId)} is at its limit — continuing on ${this.accountName(s.settings.provider, account)}`,
        )
        return true
      }
    }
    const decision = planRoute(s.settings, policy.order, {
      usage: routing.usage,
      catalogs,
      switchAt: policy.switchAt,
      now: Date.now(),
      promote,
    })
    const hold = this.holds.get(id)
    if (!decision) {
      if (hold === 'chat') this.holds.delete(id)
      return false
    }
    if (hold === 'message') {
      this.holds.delete(id)
      return false
    }
    if (hold === 'chat') return false
    if (decision.peak) this.pinned.delete(id)
    await this.applySettings(
      id,
      this.withStep(s.settings, decision.step),
      `${decision.reason} — continuing with ${providerName(decision.step.provider)}`,
    )
    return true
  }

  async fallback(id: string): Promise<void> {
    const s = this.host.get(id)
    if (this.host.shutdown() || this.host.transitioning.has(id)) return
    if (!s.settings.autoFallback) {
      if (this.host.waitForGoalProvider(id)) return
      this.host.halt(id)
      this.host.setState(id, 'failed')
      return
    }
    const attempted = this.attempted.get(id) ?? new Set([stepKey(s.settings)])
    attempted.add(stepKey(s.settings))
    this.attempted.set(id, attempted)
    this.host.transitioning.add(id)
    const resolveAttempted = (catalogs: ProviderCatalog[]) => {
      for (const key of [...attempted]) {
        const [provider, ...rest] = key.split(':')
        attempted.add(settingsKey({ provider: provider as AgentProvider, model: rest.join(':') }, catalogs))
      }
    }
    this.host.setState(id, 'starting')
    const revision = this.host.revisions.get(id) ?? 0
    try {
      this.host.halt(id)
      await this.host.draining.get(id)
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0))
        throw new Error('Provider switch cancelled')
      this.host.setState(id, 'starting')
      const catalogs = await this.host.catalog()
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0)) return
      resolveAttempted(catalogs)
      const routing = this.routing(s.settings)
      const configured =
        !!routing?.prefs.fallback.order || (!!s.parentId && routing?.prefs.subagents.fallback === 'separate')
      const policy = this.policyOf(s, catalogs, routing?.prefs)
      const tried = this.attemptedAccounts.get(id) ?? new Set<string>()
      tried.add(accountKey(s.settings.provider, s.settings.accountId))
      this.attemptedAccounts.set(id, tried)
      // The limit just hit belongs to this login, so try the provider's other logins before leaving it.
      if (routing) await this.freshAccountUsage(s.provider)
      const account = routing ? this.otherAccount(s.settings, routing, catalogs, policy.switchAt, tried) : null
      if (account) {
        tried.add(accountKey(s.provider, account))
        const accountSettings = { ...s.settings, accountId: account }
        this.pinned.delete(id)
        this.db
          .prepare('UPDATE agent_sessions SET settings = ?, provider_session_id = ? WHERE id = ?')
          .run(JSON.stringify(accountSettings), null, id)
        this.host.record(id, {
          kind: 'settings',
          settings: accountSettings,
          reason: `${providerName(s.provider)} usage limit reached on ${this.accountName(s.provider, s.settings.accountId)} — continuing on ${this.accountName(s.provider, account)}`,
          handoff: true,
          previous: s.settings,
        })
        this.host.transitioning.delete(id)
        this.host.launch(
          id,
          'Continue the unfinished request from the conversation handoff. First inspect the current files and tool results to avoid repeating completed changes.',
          null,
          false,
        )
        return
      }
      this.attemptedAccounts.delete(id)
      const step = nextStep(policy.order, {
        usage: routing?.usage ?? [],
        catalogs,
        switchAt: policy.switchAt,
        attempted,
      })
      if (!step) {
        if (this.host.waitForGoalProvider(id)) return
        this.host.fail(
          id,
          configured
            ? 'Every fallback option reached a usage limit or is unavailable. Change models or try again after the limit resets.'
            : 'Both providers reached a usage limit. Change models or try again after the limit resets.',
        )
        return
      }
      attempted.add(stepKey(step))
      const settings = this.withStep(s.settings, step)
      const same = step.provider === s.provider
      const peak = peakFor(routing?.usage ?? [], s.provider, s.settings.model)
      this.pinned.delete(id)
      this.db
        .prepare('UPDATE agent_sessions SET provider = ?, settings = ?, provider_session_id = ? WHERE id = ?')
        .run(step.provider, JSON.stringify(settings), same ? s.providerSessionId : null, id)
      this.host.record(id, {
        kind: 'settings',
        settings,
        reason: `${providerName(s.provider)} usage limit reached${peak ? ` (${limitReason(s.provider, peak).replace(`${providerName(s.provider)}'s `, '')})` : ''} — continuing with ${providerName(step.provider)}${same ? ` on ${step.model}` : ''}`,
        handoff: !same,
        previous: s.settings,
      })
      this.host.transitioning.delete(id)
      this.host.launch(
        id,
        'Continue the unfinished request from the conversation handoff. First inspect the current files and tool results to avoid repeating completed changes.',
        same ? s.providerSessionId : null,
        false,
      )
    } catch (e) {
      if (!this.host.shutdown() && revision === (this.host.revisions.get(id) ?? 0)) this.host.fail(id, e)
    } finally {
      this.host.transitioning.delete(id)
      this.host.settleChild(id)
    }
  }

  /** The settings a new sub-agent of this chat should run on, and whether Ramu (not the provider) must run it. */
  async subagentSettings(
    parentId: string,
    type?: string,
  ): Promise<{ settings: AgentSettings; reason?: string; redirect: boolean; from: AgentProvider }> {
    const parent = this.host.get(parentId)
    const prefs = this.host.preferences()
    const catalogs = await this.host.catalog()
    const base = prefs ? subagentTarget(prefs.subagents, parent.provider, type) : null
    const resolved = base ? resolveStep(base, catalogs) : null
    let settings = resolved ? this.withStep(parent.settings, resolved) : parent.settings
    let reason: string | undefined
    let redirect = !!resolved
    const routing = this.routing(settings)
    if (routing) {
      const policy = this.policyOf({ parentId }, catalogs, routing.prefs)
      const decision = planRoute(settings, policy.order, { usage: routing.usage, catalogs, switchAt: policy.switchAt })
      if (decision) {
        settings = this.withStep(settings, decision.step)
        reason = decision.reason
        redirect = true
      }
    }
    return {
      settings: { ...settings, autoFallback: parent.settings.autoFallback },
      ...(reason ? { reason } : {}),
      redirect,
      from: parent.provider,
    }
  }
}
