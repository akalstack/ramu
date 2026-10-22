import { providerAccountId } from '../providers/providerBinaries'
import { launchCompatibility } from '../providers/launchCompatibility'
import {
  AGENT_PROVIDERS,
  providerName,
  supportsProviderAccounts,
  providerAccountOrder,
} from '@ramu/shared/providers/providers'
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
  type NextMessageRoute,
  type SetupOmission,
} from '@ramu/shared/types'
import {
  capSubagentEffort,
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
  type RouteContext,
} from '@ramu/shared/providers/routing'
import { connectionsUsed } from '../mcp/sessionTools'
import { WRITING_STATES } from './constants'
import { LIMIT_CONTINUATION } from './providerWait'
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
    Pick<SessionProcess, 'fail' | 'halt' | 'launch' | 'planSwitch' | 'planTransition' | 'rememberSession'>,
    Pick<ProviderWaits, 'waitForGoalProvider'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<SessionRegistry, 'draining' | 'revisions' | 'transitioning'>,
    Pick<SessionStore, 'get' | 'events'>,
    Pick<SubagentRunner, 'settleChild'> {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  mcpDestination(): AgentService['mcpDestination']
  preferences(): AppPreferences | undefined
  preferencesSource(): (() => AppPreferences) | undefined
  refreshAccountUsage(): AgentService['refreshAccountUsage']
  shutdown(): AgentService['shutdown']
  usage(): AgentService['usage']
  setupOmissions(): AgentService['setupOmissions']
}

/** Usage-limit fallback and account/model routing: where a chat or sub-agent should run, and moving it there. */
export class FallbackRouter {
  constructor(
    private readonly host: FallbackRouterHost,
    private readonly db: Db,
  ) {}

  // Set from the composer's provider chip. The pre-emptive switch (see docs/AGENTS.md) must honour it; 'message' clears after one send.
  private readonly holds = new Map<string, 'message' | 'chat'>()

  /** Steps (`provider:model`) a chat has already been through while falling back. */
  readonly attempted = new Map<string, Set<string>>()

  /** Logins of the chat's provider already tried since its last message, as `provider:account`. */
  readonly attemptedAccounts = new Map<string, Set<string>>()

  /** Chats that already had their one quiet retry of a low-confidence limit match since their last message. */
  readonly lowConfidenceRetried = new Set<string>()

  /** Providers proven incompatible on this host, skipped as automatic destinations. */
  private blockedProviders(): Promise<ReadonlySet<AgentProvider>> {
    return process.env.RAMU_FAKE_AGENT === '1'
      ? Promise.resolve(new Set())
      : launchCompatibility.blockedProviders(AGENT_PROVIDERS)
  }

  /** Apply user changes to model, effort or access. */
  async configure(id: string, settings: AgentSettings): Promise<AgentSessionInfo> {
    const current = this.host.get(id).settings
    // The per-thread auto-resume choice changes only through setAutoResume, so a settings save never drops or sets it.
    const { autoResume: _ignored, ...incoming } = settings
    settings = current.autoResume === undefined ? incoming : { ...incoming, autoResume: current.autoResume }
    if (sameSettings(current, settings)) return this.host.get(id)
    const updated = await this.applySettings(id, settings)
    this.holds.delete(id)
    return updated
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
      // A login the thread used before resumes its own session and gets only what it missed; a new one gets the whole
      // conversation, and a conversation too large for it is refused here, before anything changes.
      const plan = this.host.planTransition(
        id,
        settings,
        !sameIdentity && settings.provider === s.provider ? 'account' : 'switch',
      )
      if (!plan.fits)
        throw new Error(
          `The conversation is too large to carry to ${providerName(settings.provider)} in one handoff. Keep this model, start a new thread from a summary, or pick a model with a larger context window.`,
        )
      const resume = plan.resume
      const handoffInfo = plan.info
      // Shared MCP access belongs to the login a chat runs on: say what the new one still lacks, never why it was chosen.
      // Checked while the old process still runs, so a slow service never leaves the chat stopped; a model or effort
      // change on the same login says nothing.
      const mcpAttention = sameIdentity
        ? undefined
        : await this.host
            .mcpDestination()?.(s, settings)
            .catch(() => [])
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0))
        throw new Error('Provider switch cancelled')
      // Terminate the old process before releasing its checkout or starting another provider.
      this.host.halt(id)
      await this.host.draining.get(id)
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0))
        throw new Error('Provider switch cancelled')
      if (!sameIdentity) this.host.rememberSession(id)
      this.db
        .prepare('UPDATE agent_sessions SET provider = ?, settings = ?, provider_session_id = ? WHERE id = ?')
        .run(settings.provider, JSON.stringify(settings), resume, id)
      this.host.record(id, {
        kind: 'settings',
        settings,
        reason:
          reason ??
          (WRITING_STATES.includes(s.state)
            ? 'Changed settings — continuing the current request'
            : 'Changed conversation settings'),
        handoff: !!handoffInfo,
        previous: s.settings,
        ...(handoffInfo ? { handoffInfo } : {}),
        ...(mcpAttention?.length ? { mcpAttention } : {}),
        ...this.omissions(s, settings),
      })
      if (WRITING_STATES.includes(s.state)) {
        this.host.transitioning.delete(id)
        this.host.launch(
          id,
          'Continue the unfinished user request with the updated conversation settings. Check existing files and tool results before repeating any completed action.',
          resume,
          false,
        )
      } else this.host.setState(id, 'restored')
      return this.host.get(id)
    } finally {
      this.host.transitioning.delete(id)
      this.host.settleChild(id)
    }
  }

  /**
   * Names of the attention items this thread has already called, so losing them would break work in progress. A
   * connection the thread never used is only noted on the settings event; it does not stop a fallback.
   */
  private requiredLost(id: string, attention: { name: string; connectionId?: string }[]): string[] {
    const ids = attention.flatMap((item) => (item.connectionId ? [item.connectionId] : []))
    if (!ids.length) return []
    const tools = this.host
      .events(id)
      .flatMap((event) => (event.kind === 'tool-use' && !event.agentId ? [event.name] : []))
    const used = connectionsUsed(tools, ids)
    return attention.filter((item) => item.connectionId && used.has(item.connectionId)).map((item) => item.name)
  }

  /**
   * The next login of the provider that has room, preferring one that lacks none of the thread's Shared MCP connections.
   * Bounded: at most five candidates are checked, each at most as slowly as one destination check.
   */
  private async readyAccount(
    s: AgentSessionInfo,
    routing: NonNullable<ReturnType<FallbackRouter['routing']>>,
    catalogs: ProviderCatalog[],
    switchAt: Parameters<FallbackRouter['otherAccount']>[3],
    tried: Set<string>,
  ): Promise<{ account: string; attention: Awaited<ReturnType<FallbackRouter['mcpAttention']>> } | null> {
    const skipped = new Set(tried)
    let first: { account: string; attention: Awaited<ReturnType<FallbackRouter['mcpAttention']>> } | null = null
    for (let candidate = 0; candidate < 5; candidate++) {
      const account = this.otherAccount(s.settings, routing, catalogs, switchAt, skipped)
      if (!account) break
      const attention = await this.mcpAttention(s, { ...s.settings, accountId: account })
      if (!attention.length) return { account, attention }
      first ??= { account, attention }
      skipped.add(accountKey(s.provider, account))
    }
    return first
  }

  /** Shared MCP connections the destination login still lacks; empty when the login did not change. */
  private async mcpAttention(s: AgentSessionInfo, next: AgentSettings) {
    if (next.provider === s.provider && (next.accountId ?? 'default') === (s.settings.accountId ?? 'default')) return []
    return (
      (await this.host
        .mcpDestination()?.(s, next)
        .catch(() => [])) ?? []
    )
  }

  /**
   * What the destination login lacks from the thread's agent setup, resolved on this host before launch. A missing
   * approval or sign-in is reported next to the switch and never read as a usage limit; the request continues without
   * those tools rather than as though they were present.
   */
  private omissions(session: AgentSessionInfo, settings: AgentSettings): { setupOmissions?: SetupOmission[] } {
    try {
      const found = this.host.setupOmissions()?.(session, settings) ?? []
      return found.length ? { setupOmissions: found } : {}
    } catch {
      return {}
    }
  }

  /** Clear the hold to allow usage-limit fallback again. */
  holdProvider(id: string, scope: 'message' | 'chat' | null): void {
    if (scope) this.holds.set(id, scope)
    else this.holds.delete(id)
  }

  providerHold(id: string): 'message' | 'chat' | null {
    return this.holds.get(id) ?? null
  }

  /** Where the next message would run, using the routing a send applies. Reads only: it changes nothing and fetches nothing. */
  async nextRoute(id: string): Promise<NextMessageRoute> {
    const s = this.host.get(id)
    const routing = this.routing(s.settings)
    if (!routing) return { state: 'unknown' }
    const catalogs = await this.host.catalog()
    const policy = this.policyOf(s, catalogs, routing.prefs)
    const decision = planRoute(s.settings, policy.order, {
      usage: routing.usage,
      accounts: routing.accounts,
      catalogs,
      switchAt: policy.switchAt,
      now: Date.now(),
      attemptedAccounts: this.attemptedAccounts.get(id),
      blocked: await this.blockedProviders(),
    })
    if (!decision) return { state: 'stays' }
    const { provider, model, accountId } = decision.step
    return {
      state: 'switch',
      provider,
      model,
      ...(accountId ? { accountId } : {}),
      reason: decision.reason,
      held: this.holds.get(id) ?? null,
    }
  }

  /** Preferences and usage, once the app has provided them; tests run without. */
  routing(settings?: AgentSettings): {
    prefs: AppPreferences
    usage: UsageReading[]
    all: UsageReading[]
    accounts: NonNullable<RouteContext['accounts']>
  } | null {
    const source = this.host.preferencesSource()
    const usage = this.host.usage()
    if (!source || !usage) return null
    const prefs = source()
    const all = usage.all?.() ?? usage.list()
    return {
      prefs,
      usage: usage.list(
        settings ? { [settings.provider]: settings.accountId ?? providerAccountId(settings.provider) } : {},
      ),
      all,
      accounts: { configuration: prefs.providerBinaries, usage: all },
    }
  }

  /** Another login of the same provider with room, when the user turned account rotation on for it; null otherwise. */
  otherAccount(
    settings: AgentSettings,
    routing: { prefs: AppPreferences },
    catalogs: ProviderCatalog[],
    switchAt: SwitchThreshold,
    tried?: ReadonlySet<string>,
  ): string | null {
    if (!settings.autoFallback || !supportsProviderAccounts(settings.provider)) return null
    if (launchCompatibility.isBlocked(settings.provider)) return null
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
  async freshAccountUsage(provider: AgentProvider): Promise<void> {
    const refresh = this.host.refreshAccountUsage()
    if (!refresh) return
    await Promise.race([
      refresh(provider).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 8_000).unref()),
    ])
  }

  private accountName(provider: AgentProvider, accountId: string | undefined): string {
    if (!accountId || accountId === 'default') return 'the default account'
    return `account "${
      this.host
        .preferences()
        ?.providerBinaries[provider]?.accounts?.find((entry) => entry.id === accountId)
        ?.name?.trim() || accountId
    }"`
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

  withStep(settings: AgentSettings, step: FallbackStep & { accountId?: string }): AgentSettings {
    return {
      ...settings,
      accountId:
        step.accountId ??
        (step.provider === settings.provider
          ? (settings.accountId ?? providerAccountId(settings.provider))
          : providerAccountId(step.provider)),
      provider: step.provider,
      model: step.model,
      effort: step.effort,
      serviceTier: step.serviceTier ?? 'standard',
    }
  }

  /** Route foreground and background work only when its model reaches the usage threshold. */
  async route(settings: AgentSettings): Promise<RouteDecision | null> {
    let routing = this.routing(settings)
    if (!routing || !settings.autoFallback) return null
    const catalogs = await this.host.catalog()
    const model =
      resolveStep({ id: '', provider: settings.provider, model: settings.model, effort: null }, catalogs)?.model ??
      settings.model
    if (isOver(peakFor(routing.usage, settings.provider, model), routing.prefs.fallback.switchAt)) {
      await this.freshAccountUsage(settings.provider)
      routing = this.routing(settings) ?? routing
    }
    return planRoute(settings, this.orderOf(catalogs, routing.prefs), {
      usage: routing.usage,
      accounts: routing.accounts,
      catalogs,
      switchAt: routing.prefs.fallback.switchAt,
      blocked: await this.blockedProviders(),
    })
  }

  /** Explains a switch made before a chat started. */
  noteRoute(id: string, from: AgentSettings, to: AgentSettings, reason: string): void {
    this.host.record(id, {
      kind: 'settings',
      settings: to,
      reason: `${reason} — continuing ${from.provider === to.provider && from.accountId !== to.accountId ? `on ${this.accountName(to.provider, to.accountId)}` : `with ${providerName(to.provider)}`}`,
      handoff: false,
      previous: from,
    })
  }

  /** Before sending, fall back only at the usage threshold, respecting explicit composer holds. */
  async switchBeforeSend(id: string): Promise<boolean> {
    const s = this.host.get(id)
    let routing = this.routing(s.settings)
    if (!routing) return false
    const catalogs = await this.host.catalog()
    const policy = this.policyOf(s, catalogs, routing.prefs)
    const model =
      resolveStep({ id: '', provider: s.provider, model: s.settings.model, effort: null }, catalogs)?.model ??
      s.settings.model
    if (
      !this.holds.has(id) &&
      s.settings.autoFallback &&
      isOver(peakFor(routing.usage, s.provider, model), policy.switchAt)
    ) {
      const tried = this.attemptedAccounts.get(id) ?? new Set<string>()
      tried.add(accountKey(s.provider, s.settings.accountId))
      this.attemptedAccounts.set(id, tried)
      await this.freshAccountUsage(s.provider)
      routing = this.routing(s.settings) ?? routing
    }
    const decision = planRoute(s.settings, policy.order, {
      usage: routing.usage,
      accounts: routing.accounts,
      catalogs,
      switchAt: policy.switchAt,
      now: Date.now(),
      attemptedAccounts: this.attemptedAccounts.get(id),
      blocked: await this.blockedProviders(),
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
    if (decision.step.accountId)
      this.attemptedAccounts.get(id)?.add(accountKey(decision.step.provider, decision.step.accountId))
    await this.applySettings(
      id,
      this.cappedChildSettings(s, this.withStep(s.settings, decision.step), catalogs),
      `${decision.reason} — continuing ${decision.step.provider === s.provider && decision.step.accountId !== s.settings.accountId ? `on ${this.accountName(s.provider, decision.step.accountId)}` : `with ${providerName(decision.step.provider)}`}`,
    )
    return true
  }

  /**
   * A low-confidence limit match (a bare "rate limit" or 429) gets one quiet retry on the same provider before the thread
   * enters the limit wait, so a misread error does not park it. False once the retry was used: the caller then waits.
   */
  retryQuietly(id: string): boolean {
    if (this.host.shutdown() || this.host.transitioning.has(id) || this.lowConfidenceRetried.has(id)) return false
    this.lowConfidenceRetried.add(id)
    const revision = this.host.revisions.get(id) ?? 0
    this.host.transitioning.add(id)
    void (async () => {
      try {
        this.host.halt(id)
        await this.host.draining.get(id)
        if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0)) return
        this.host.transitioning.delete(id)
        this.host.launch(id, LIMIT_CONTINUATION, this.host.get(id).providerSessionId, false)
      } catch (e) {
        if (!this.host.shutdown() && revision === (this.host.revisions.get(id) ?? 0)) this.host.fail(id, e)
      } finally {
        this.host.transitioning.delete(id)
        this.host.settleChild(id)
      }
    })()
    return true
  }

  async fallback(id: string, confidence: 'high' | 'low' = 'high'): Promise<void> {
    const s = this.host.get(id)
    if (this.host.shutdown() || this.host.transitioning.has(id)) return
    if (confidence === 'low' && this.retryQuietly(id)) return
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
      const catalogs = await this.host.catalog()
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0)) return
      resolveAttempted(catalogs)
      let routing = this.routing(s.settings)
      const configured =
        !!routing?.prefs.fallback.order || (!!s.parentId && routing?.prefs.subagents.fallback === 'separate')
      const policy = this.policyOf(s, catalogs, routing?.prefs)
      const tried = this.attemptedAccounts.get(id) ?? new Set<string>()
      tried.add(accountKey(s.settings.provider, s.settings.accountId))
      this.attemptedAccounts.set(id, tried)
      // The limit just hit belongs to this login, so try the provider's other logins before leaving it.
      if (routing) {
        await this.freshAccountUsage(s.provider)
        routing = this.routing(s.settings) ?? routing
      }
      // Prefer a login that already has the thread's Shared MCP access: usage decides which logins have room, and
      // connection readiness only orders them. When every candidate lacks something the first still gets the notice.
      const choice = routing ? await this.readyAccount(s, routing, catalogs, policy.switchAt, tried) : null
      const account = choice?.account ?? null
      const accountPlan = account
        ? this.host.planSwitch(id, { provider: s.provider, accountId: account }, 'limit')
        : null
      if (account && accountPlan?.fits) {
        const accountAttention = choice!.attention
        if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0)) return
        // Never move a thread onto a login that would silently lose a connection it was already using.
        const lost = this.requiredLost(id, accountAttention)
        if (lost.length) {
          this.host.halt(id)
          await this.host.draining.get(id)
          this.host.record(id, {
            kind: 'error',
            message: `Continuing on ${this.accountName(s.provider, account)} would leave ${lost.join(', ')} without access that this thread was using. Choose another account from the model menu, or approve ${lost.length === 1 ? 'it' : 'them'} for that login in Settings → Providers, then send again.`,
          })
          this.host.transitioning.delete(id)
          this.host.setState(id, 'failed')
          return
        }
        this.host.halt(id)
        await this.host.draining.get(id)
        if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0)) return
        tried.add(accountKey(s.provider, account))
        const accountSettings = { ...s.settings, accountId: account }
        this.host.rememberSession(id)
        this.db
          .prepare('UPDATE agent_sessions SET settings = ?, provider_session_id = ? WHERE id = ?')
          .run(JSON.stringify(accountSettings), accountPlan.resume, id)
        this.host.record(id, {
          kind: 'settings',
          settings: accountSettings,
          reason: `${providerName(s.provider)} usage limit reached on ${this.accountName(s.provider, s.settings.accountId)} — continuing on ${this.accountName(s.provider, account)}`,
          handoff: true,
          previous: s.settings,
          handoffInfo: accountPlan.info,
          ...(accountAttention.length ? { mcpAttention: accountAttention } : {}),
          ...this.omissions(s, accountSettings),
        })
        this.host.transitioning.delete(id)
        this.host.launch(
          id,
          'Continue the unfinished request from the conversation handoff. First inspect the current files and tool results to avoid repeating completed changes.',
          accountPlan.resume,
          false,
        )
        return
      }
      this.attemptedAccounts.delete(id)
      const blocked = await this.blockedProviders()
      const next = () =>
        nextStep(policy.order, {
          usage: routing?.usage ?? [],
          accounts: routing?.accounts,
          catalogs,
          switchAt: policy.switchAt,
          attempted,
          blocked,
        })
      // A conversation that does not fit another provider's handoff budget is never sent truncated: skip that model, and
      // if nothing else is left, hold the thread at the limit with the reason.
      let step = next()
      let plan: ReturnType<SessionProcess['planTransition']> | null = null
      let tooLarge: AgentProvider | null = null
      let rejected: string | undefined
      while (step) {
        try {
          const models = catalogs.find((catalog) => catalog.provider === step!.provider)?.models
          const model = step.model
            ? models?.find((model) => model.id === step!.model)
            : (models?.find((model) => model.isDefault) ?? models?.[0])
          plan = this.host.planTransition(
            id,
            this.cappedChildSettings(s, this.withStep(s.settings, step), catalogs),
            'limit',
            model?.contextWindow,
          )
          if (plan.fits) break
          tooLarge = step.provider
        } catch (error) {
          rejected = error instanceof Error ? error.message : String(error)
        }
        attempted.add(stepKey(step))
        step = next()
      }
      if (!step) {
        this.host.halt(id)
        await this.host.draining.get(id)
        if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0)) return
        const reason = tooLarge
          ? `The conversation is too large to carry to ${providerName(tooLarge)} in one handoff, so ${providerName(s.provider)} is the only option.`
          : (rejected ??
            (blocked.size
              ? `${[...blocked].map(providerName).join(', ')} cannot run on this host with this Ramu release. Update it or change its executable path in Settings → Providers.`
              : undefined))
        if (this.host.waitForGoalProvider(id, reason)) return
        this.host.fail(
          id,
          configured
            ? blocked.size
              ? `Every fallback option reached a usage limit or is unavailable, and ${[...blocked].map(providerName).join(', ')} is not compatible with this Ramu release. Update it in Settings → Providers or change models.`
              : 'Every fallback option reached a usage limit or is unavailable. Change models or try again after the limit resets.'
            : 'Both providers reached a usage limit. Change models or try again after the limit resets.',
        )
        return
      }
      attempted.add(stepKey(step))
      const settings = this.cappedChildSettings(s, this.withStep(s.settings, step), catalogs)
      const same = step.provider === s.provider
      const peak = peakFor(routing?.usage ?? [], s.provider, s.settings.model)
      const resume = plan?.resume ?? null
      const fallbackAttention = await this.mcpAttention(s, settings)
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0)) return
      this.host.halt(id)
      await this.host.draining.get(id)
      if (this.host.shutdown() || revision !== (this.host.revisions.get(id) ?? 0)) return
      if (!same || (settings.accountId ?? 'default') !== (s.settings.accountId ?? 'default'))
        this.host.rememberSession(id)
      this.db
        .prepare('UPDATE agent_sessions SET provider = ?, settings = ?, provider_session_id = ? WHERE id = ?')
        .run(step.provider, JSON.stringify(settings), resume, id)
      this.host.record(id, {
        kind: 'settings',
        settings,
        reason: `${providerName(s.provider)} usage limit reached${peak ? ` (${limitReason(s.provider, peak).replace(`${providerName(s.provider)}'s `, '')})` : ''} — continuing with ${providerName(step.provider)}${same ? ` on ${step.model}` : ''}`,
        handoff: !!plan?.info,
        previous: s.settings,
        ...(plan?.info ? { handoffInfo: plan.info } : {}),
        ...(fallbackAttention.length ? { mcpAttention: fallbackAttention } : {}),
        ...this.omissions(s, settings),
      })
      this.host.transitioning.delete(id)
      this.host.launch(
        id,
        'Continue the unfinished request from the conversation handoff. First inspect the current files and tool results to avoid repeating completed changes.',
        resume,
        false,
      )
    } catch (e) {
      if (!this.host.shutdown() && revision === (this.host.revisions.get(id) ?? 0)) this.host.fail(id, e)
    } finally {
      this.host.transitioning.delete(id)
      this.host.settleChild(id)
    }
  }

  private cappedChildSettings(
    session: AgentSessionInfo,
    settings: AgentSettings,
    catalogs: ProviderCatalog[],
  ): AgentSettings {
    const prefs = this.host.preferences()?.subagents
    return session.parentId && prefs ? capSubagentEffort(settings, prefs, catalogs) : settings
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
      const decision = planRoute(settings, policy.order, {
        usage: routing.usage,
        accounts: routing.accounts,
        catalogs,
        switchAt: policy.switchAt,
        blocked: await this.blockedProviders(),
      })
      if (decision) {
        settings = this.withStep(settings, decision.step)
        reason = decision.reason
        redirect = true
      }
    }
    // Auto-resume is not copied: a helper follows its parent's effective value live (see ProviderWaits.autoResumeOf).
    const { autoResume: _inherited, ...own } = settings
    return {
      settings: { ...own, autoFallback: parent.settings.autoFallback },
      ...(reason ? { reason } : {}),
      redirect,
      from: parent.provider,
    }
  }
}
