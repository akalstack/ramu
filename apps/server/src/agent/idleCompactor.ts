import type { AgentSessionState, AppPreferences } from '@ramu/shared/types'
import type { ContextUsageTracker } from './contextUsage'
import type { SessionRegistry } from './sessionRegistry'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionStore } from './sessionStore'

/** The summary turn must still read the cache, so it starts this long before the cache lapses. */
const MARGIN_MS = 60_000
const FIVE_MINUTES_MS = 5 * 60_000
const ONE_HOUR_MS = 60 * 60_000
/** Below this a cold re-read is cheap enough that a summary turn would cost more than it saves. */
export const IDLE_COMPACT_MIN_TOKENS = 200_000

/**
 * How long the main conversation's prompt cache lasts, following Claude Code's rules: the one-hour cache applies only to a
 * Claude subscription within its plan usage; usage credits, an API key or a cloud provider get five minutes. The
 * environment variables Claude Code reads to force or choose a TTL win, in its order. A named Ramu account is a
 * subscription login; the default profile counts as key-based when the environment has an API key or cloud provider.
 */
export function promptCacheTtlMs(
  input: { accountId?: string; usingCredits?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (env.FORCE_PROMPT_CACHING_5M === '1') return FIVE_MINUTES_MS
  const chosen = env.CLAUDE_CODE_PROMPT_CACHE_TTL
  if (chosen === '5m') return FIVE_MINUTES_MS
  if (chosen === '1h') return ONE_HOUR_MS
  if (env.ENABLE_PROMPT_CACHING_1H === '1') return ONE_HOUR_MS
  const usesKey =
    (!input.accountId || input.accountId === 'default') &&
    !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX)
  return usesKey || input.usingCredits ? FIVE_MINUTES_MS : ONE_HOUR_MS
}

/** When to compact after the thread goes idle: just before its cache lapses. */
export function idleCompactDelay(
  input: { accountId?: string; usingCredits?: boolean },
  env?: NodeJS.ProcessEnv,
): number {
  return promptCacheTtlMs(input, env) - MARGIN_MS
}

export interface IdleCompactorHost
  extends
    Pick<SessionRegistry, 'live' | 'runners'>,
    Pick<SessionRecorder, 'setState'>,
    Pick<SessionStore, 'get' | 'hasRunningTasks' | 'queued'>,
    Pick<ContextUsageTracker, 'context'> {
  preferences(): AppPreferences | undefined
  shutdown(): boolean
}

/** Summarizes a long idle Claude thread just before its prompt cache lapses, so the next message re-reads a short context. */
export class IdleCompactor {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Threads whose last rate-limit event said Claude is spending usage credits, which shortens the main cache to five minutes. */
  private readonly credits = new Set<string>()

  constructor(
    private readonly host: IdleCompactorHost,
    private readonly delayMs?: number,
  ) {}

  noteCredits(id: string, usingCredits: boolean): void {
    if (usingCredits) this.credits.add(id)
    else this.credits.delete(id)
  }

  /** Called on every state change: a thread that turns idle is scheduled, anything else cancels. */
  stateChanged(id: string, state: AgentSessionState): void {
    this.cancel(id)
    if (state !== 'idle' || this.host.shutdown() || !this.host.preferences()?.idleCompaction) return
    const timer = setTimeout(
      () => this.compact(id),
      this.delayMs ??
        idleCompactDelay({ accountId: this.host.get(id).settings.accountId, usingCredits: this.credits.has(id) }),
    )
    timer.unref?.()
    this.timers.set(id, timer)
  }

  cancel(id: string): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
  }

  clear(): void {
    for (const id of [...this.timers.keys()]) this.cancel(id)
  }

  private compact(id: string): void {
    this.timers.delete(id)
    if (this.host.shutdown() || !this.host.preferences()?.idleCompaction) return
    const s = this.host.get(id)
    const live = this.host.live.get(id)
    const used = this.host.context(id)?.used ?? 0
    if (
      s.provider !== 'claude-code' ||
      s.parentId ||
      s.state !== 'idle' ||
      !live ||
      this.host.runners.has(id) ||
      this.host.hasRunningTasks(id) ||
      this.host.queued(id).length ||
      used < IDLE_COMPACT_MIN_TOKENS
    )
      return
    // Running first keeps a message sent now queued behind the summary instead of racing it.
    this.host.setState(id, 'running')
    live.input.push('/compact')
  }
}
