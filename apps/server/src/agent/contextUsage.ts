import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage, UsageReading, AppPreferences } from '@ramu/shared/types'
import type { QueryFn } from './types'
import { ClaudeUsageReader } from './usageReader'
import type { SessionRegistry } from './sessionRegistry'
import type { AgentService } from '../agent'

/** What ContextUsageTracker needs from the rest of the service. */
export interface ContextUsageTrackerHost extends Pick<SessionRegistry, 'live'> {
  onContext(): AgentService['onContext']
  preferences(): AppPreferences | undefined
  providerQuery: QueryFn
  shutdown(): AgentService['shutdown']
  usage(): AgentService['usage']
}

/** Context-window and plan usage readings for chats. */
export class ContextUsageTracker {
  constructor(private readonly host: ContextUsageTrackerHost) {}

  private readonly contexts = new Map<string, ContextUsage>()

  readonly usageReader = new ClaudeUsageReader({
    usage: () => this.host.usage(),
    shutdown: () => this.host.shutdown(),
    providerQuery: (args) => this.host.providerQuery(args),
    providerBinaries: () => this.host.preferences()?.providerBinaries,
  })

  context(id: string): ContextUsage | null {
    return this.contexts.get(id) ?? null
  }

  setContext(id: string, used: number, max: number): void {
    if (!(max > 0)) return
    const context: ContextUsage = { used, max, percent: Math.min(100, Math.round((used / max) * 100)), at: Date.now() }
    this.contexts.set(id, context)
    this.host.onContext()?.(id, context)
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
