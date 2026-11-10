import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSettings, ContextUsage, UsageReading, AppPreferences } from '@ramu/shared/types'
import { promptCacheTtlMs } from '@ramu/shared/chat/compaction'
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
  /** The latest main Claude request per thread, so the composer can tell when its prompt cache has expired. */
  /** Threads whose kept reading was already looked up on disk, so a thread without one is not read again. */
  private readonly loaded = new Set<string>()
  private readonly requests = new Map<string, { lastRequestAt: number; cacheTtlMs?: number }>()

  private selection(settings: Pick<AgentSettings, 'provider' | 'accountId' | 'model'>): string {
    return JSON.stringify([settings.provider, settings.accountId ?? 'default', settings.model])
  }

  readonly usageReader = new ClaudeUsageReader({
    usage: () => this.host.usage(),
    shutdown: () => this.host.shutdown(),
    providerQuery: (args) => this.host.providerQuery(args),
    providerBinaries: () => this.host.preferences()?.providerBinaries,
  })

  /**
   * The thread's latest reading. It is kept on disk too, so after the host restarts the composer still knows how large
   * an idle thread is and when its prompt cache ran out, before the thread's next turn reads it again.
   */
  context(id: string): ContextUsage | null {
    const saved = this.contexts.get(id) ?? this.stored(id)
    return saved?.selection === this.selection(this.host.get(id).settings) ? saved.value : null
  }

  private stored(id: string): { value: ContextUsage; selection: string } | undefined {
    if (this.loaded.has(id)) return this.contexts.get(id)
    this.loaded.add(id)
    const row = this.db.prepare('SELECT selection, data FROM session_context WHERE session_id = ?').get(id) as
      { selection: string; data: string } | undefined
    if (!row) return undefined
    try {
      const saved = { value: JSON.parse(row.data) as ContextUsage, selection: row.selection }
      this.contexts.set(id, saved)
      return saved
    } catch {
      return undefined
    }
  }

  setContext(id: string, used: number, max: number): void {
    if (!Number.isFinite(max) || !(max > 0) || !Number.isFinite(used) || used < 0) return
    const settings = this.host.get(id).settings
    this.rememberModelContext(settings, max)
    const context: ContextUsage = {
      used,
      max,
      percent: Math.min(100, Math.round((used / max) * 100)),
      at: Date.now(),
      ...this.lastRequest(id),
    }
    const selection = this.selection(settings)
    this.contexts.set(id, { value: context, selection })
    this.db
      .prepare(
        `INSERT INTO session_context (session_id, selection, data) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET selection = excluded.selection, data = excluded.data`,
      )
      .run(id, selection, JSON.stringify(context))
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
    this.requests.delete(id)
    this.db.prepare('DELETE FROM session_context WHERE session_id = ?').run(id)
  }

  /** The latest request this process saw, or the one kept with the last reading from before a restart. */
  private lastRequest(id: string): { lastRequestAt: number; cacheTtlMs?: number } | undefined {
    const seen = this.requests.get(id)
    if (seen) return seen
    const kept = (this.contexts.get(id) ?? this.stored(id))?.value
    return kept?.lastRequestAt
      ? { lastRequestAt: kept.lastRequestAt, ...(kept.cacheTtlMs ? { cacheTtlMs: kept.cacheTtlMs } : {}) }
      : undefined
  }

  /**
   * A main Claude reply arrived. Its cache lifetime counts from about now; a reply read fully from cache wrote no entry
   * but refreshed the existing one, which keeps the lifetime reported last. The next context reading carries both.
   */
  noteRequest(id: string, cacheCreation: Parameters<typeof promptCacheTtlMs>[0], at = Date.now()): void {
    const cacheTtlMs = promptCacheTtlMs(cacheCreation) ?? this.lastRequest(id)?.cacheTtlMs
    this.requests.set(id, { lastRequestAt: at, ...(cacheTtlMs ? { cacheTtlMs } : {}) })
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
