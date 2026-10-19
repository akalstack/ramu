import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSettings, ContextUsage, UsageReading, AppPreferences } from '@ramu/shared/types'
import type { QueryFn } from './types'
import { ClaudeUsageReader } from './usageReader'
import type { SessionRegistry } from './sessionRegistry'
import type { AgentService } from '../agent'
import type { SessionStore } from './sessionStore'
import type { Db } from '../db'

/** What ContextUsageTracker needs from the rest of the service. */
export interface ContextUsageTrackerHost extends Pick<SessionRegistry, 'live'>, Pick<SessionStore, 'get'> {
  onContext(): AgentService['onContext']
  preferences(): AppPreferences | undefined
  providerQuery: QueryFn
  shutdown(): AgentService['shutdown']
  usage(): AgentService['usage']
}

/** Context-window and plan usage readings for chats. */
export class ContextUsageTracker {
  constructor(
    private readonly host: ContextUsageTrackerHost,
    private readonly db: Db,
  ) {}

  private readonly contexts = new Map<string, { value: ContextUsage; selection: string }>()

  private selection(settings: Pick<AgentSettings, 'provider' | 'accountId' | 'model'>): string {
    return JSON.stringify([settings.provider, settings.accountId ?? 'default', settings.model])
  }

  readonly usageReader = new ClaudeUsageReader({
    usage: () => this.host.usage(),
    shutdown: () => this.host.shutdown(),
    providerQuery: (args) => this.host.providerQuery(args),
    providerBinaries: () => this.host.preferences()?.providerBinaries,
  })

  context(id: string): ContextUsage | null {
    const saved = this.contexts.get(id)
    return saved?.selection === this.selection(this.host.get(id).settings) ? saved.value : null
  }

  setContext(id: string, used: number, max: number): void {
    if (!Number.isFinite(max) || !(max > 0) || !Number.isFinite(used) || used < 0) return
    const settings = this.host.get(id).settings
    this.rememberModelContext(settings, max)
    const context: ContextUsage = { used, max, percent: Math.min(100, Math.round((used / max) * 100)), at: Date.now() }
    this.contexts.set(id, { value: context, selection: this.selection(settings) })
    this.host.onContext()?.(id, context)
  }

  rememberModelContext(settings: Pick<AgentSettings, 'provider' | 'accountId' | 'model'>, max: number): void {
    if (!Number.isFinite(max) || max <= 0) return
    this.db
      .prepare(
        `INSERT INTO model_context_windows (provider, account_id, model, context_max) VALUES (?, ?, ?, ?)
      ON CONFLICT(provider, account_id, model) DO UPDATE SET context_max = excluded.context_max`,
      )
      .run(settings.provider, settings.accountId ?? 'default', settings.model, max)
  }

  modelContextWindow(settings: Pick<AgentSettings, 'provider' | 'accountId' | 'model'>): number | null {
    const row = this.db
      .prepare('SELECT context_max FROM model_context_windows WHERE provider = ? AND account_id = ? AND model = ?')
      .get(settings.provider, settings.accountId ?? 'default', settings.model) as { context_max: number } | undefined
    return row?.context_max ?? null
  }

  clearContext(id: string): void {
    this.contexts.delete(id)
  }

  /** Claude's context size is read after each turn, and on the first start, without a model call. */
  refreshContext(id: string, query: Query): void {
    void query
      .getContextUsage?.({ detail: 'summary' })
      .then((usage) => {
        if (this.host.live.get(id)?.query === query) this.setContext(id, usage.totalTokens, usage.maxTokens)
      })
      .catch(() => {})
  }

  /** One Claude login's plan usage, read with a throwaway process. */
  claudeAccountUsage(account: string): Promise<UsageReading[]> {
    return this.usageReader.account(account)
  }

  /** Reads Claude's plan usage now with a throwaway process, when the stored reading is old or missing. */
  readClaudeUsage(): Promise<void> {
    return this.usageReader.read()
  }
}
