import type { AgentSessionState, AppPreferences } from '@ramu/shared/types'
import type { ContextUsageTracker } from './contextUsage'
import type { SessionRegistry } from './sessionRegistry'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionStore } from './sessionStore'

/** Claude keeps a prompt cache for five minutes; the summary turn must still read it, so it starts a little before. */
export const IDLE_COMPACT_AFTER_MS = 4 * 60_000
/** Below this a cold re-read is cheap enough that a summary turn would cost more than it saves. */
export const IDLE_COMPACT_MIN_TOKENS = 50_000

export interface IdleCompactorHost
  extends Pick<SessionRegistry, 'live' | 'runners'>,
    Pick<SessionRecorder, 'setState'>,
    Pick<SessionStore, 'get' | 'hasRunningTasks' | 'queued'>,
    Pick<ContextUsageTracker, 'context'> {
  preferences(): AppPreferences | undefined
  shutdown(): boolean
}

/** Summarizes a long idle Claude thread just before its prompt cache lapses, so the next message re-reads a short context. */
export class IdleCompactor {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly host: IdleCompactorHost,
    private readonly delayMs = IDLE_COMPACT_AFTER_MS,
  ) {}

  /** Called on every state change: a thread that turns idle is scheduled, anything else cancels. */
  stateChanged(id: string, state: AgentSessionState): void {
    this.cancel(id)
    if (state !== 'idle' || this.host.shutdown() || !this.host.preferences()?.idleCompaction) return
    const timer = setTimeout(() => this.compact(id), this.delayMs)
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
