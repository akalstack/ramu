import { randomUUID } from 'node:crypto'
import type { OnUserDialog, PermissionResult, Query } from '@anthropic-ai/claude-agent-sdk'
import type { AppPreferences } from '@ramu/shared/types'
import { goalContinues } from '@ramu/shared/chat/goalHold'
import {
  DEFAULT_IDLE_COMPACTION,
  idleCompactionHeld,
  idleCompactionWindow,
  promptCacheTtlMs,
  resumeCompactionChoice,
  resumeCompactionQuestion,
  type CachedRequest,
  type IdleCompactionMode,
} from '@ramu/shared/chat/idleCompaction'
import type { GoalManager } from './goalManager'
import type { ProviderWaits } from './providerWait'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { SessionStore } from './sessionStore'
import type { UserRequests } from './userRequests'
import type { PendingRequest } from './types'
import type { AgentService } from '../agent'

/** What IdleCompactor needs from the rest of the service. */
export interface IdleCompactorHost
  extends
    Pick<GoalManager, 'getGoal'>,
    Pick<ProviderWaits, 'providerWait'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<SessionRegistry, 'live'>,
    Pick<SessionStore, 'get' | 'hasRunningTasks' | 'queued' | 'threadDone'>,
    Pick<UserRequests, 'hasBlockingQuestions'> {
  preferences(): AppPreferences | undefined
  savePreferences(): AgentService['savePreferences']
}

/** A Claude response's usage, as the SDK reports it on each assistant message. */
type ResponseUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: { ephemeral_1h_input_tokens?: number | null; ephemeral_5m_input_tokens?: number | null } | null
}

/**
 * Compacts long idle Claude threads the way the person chose in Settings. In `beforeCacheExpires`, a finished turn arms
 * one timer for shortly before its prompt cache expires; when it fires on a thread that is still idle, `/compact` goes
 * to the same Claude process without changing the thread's state, so nothing reads as a new run or notifies. Claude's
 * return prompt (`resume_return`) becomes a question in the thread unless the mode is `off`. Timers live in memory:
 * after a restart the Claude process is gone too, and the return question covers the next message.
 */
export class IdleCompactor {
  constructor(private readonly host: IdleCompactorHost) {}

  /** The latest main-thread request per session, for the process that made it. */
  private readonly requests = new Map<
    string,
    { query: Query; startedAt?: number; ttlMs?: number; last?: CachedRequest }
  >()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Idle compactions sent and not yet finished. */
  private readonly sent = new Map<string, Query>()
  /** The person chose to compact on return; Claude's compaction that follows is labelled with it. */
  private readonly chosen = new Set<string>()
  /** The running turn compacted already, so the idle spell after it needs none. */
  private readonly compactedThisTurn = new Set<string>()

  private mode(): IdleCompactionMode {
    return this.host.preferences()?.idleCompaction ?? DEFAULT_IDLE_COMPACTION
  }

  /** A main-thread Claude request began: its cache lifetime counts from here. */
  requestStarted(id: string, query: Query, at = Date.now()): void {
    const previous = this.requests.get(id)
    this.requests.set(id, { ...(previous?.query === query ? previous : {}), query, startedAt: at })
  }

  /** A main-thread response's usage: how long its cache lives and what the next request re-sends. */
  responseUsage(id: string, query: Query, usage: ResponseUsage | undefined): void {
    if (!usage) return
    const current = this.requests.get(id)
    const entry = current?.query === query ? current : { query }
    // A response read fully from cache wrote no entry but still refreshed the cache, for the lifetime seen last.
    const ttlMs = promptCacheTtlMs(usage.cache_creation) ?? entry.ttlMs
    const contextTokens =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.output_tokens ?? 0)
    this.requests.set(id, {
      ...entry,
      ttlMs,
      last: ttlMs === undefined ? undefined : { at: entry.startedAt ?? Date.now(), ttlMs, contextTokens },
    })
  }

  /** Why a compaction on this process is running, when Ramu started it. */
  compactionTrigger(id: string, query: Query): 'idle' | 'resume' | undefined {
    if (this.sent.get(id) === query) return 'idle'
    return this.chosen.has(id) ? 'resume' : undefined
  }

  /** A compaction finished or failed on this process. */
  compacted(id: string, query: Query): void {
    this.chosen.delete(id)
    if (this.sent.get(id) !== query) this.compactedThisTurn.add(id)
  }

  /**
   * A turn ended with its result. Returns true when it was Ramu's idle compaction, whose end leaves the thread's state
   * as it is: idle, or running a message the person sent meanwhile. Any other turn re-arms the timer.
   */
  turnEnded(id: string, query: Query): boolean {
    this.cancel(id)
    if (this.sent.get(id) === query) {
      this.sent.delete(id)
      this.compactedThisTurn.delete(id)
      return true
    }
    if (this.compactedThisTurn.delete(id)) return false
    const window = idleCompactionWindow(this.mode(), this.request(id, query), Date.now())
    if (window) {
      const timer = setTimeout(() => this.fire(id, query), Math.max(0, window.startMs - Date.now()))
      timer.unref?.()
      this.timers.set(id, timer)
    }
    return false
  }

  /** The process ended: nothing it scheduled or sent can still finish. */
  closed(id: string, query: Query): void {
    if (this.requests.get(id)?.query === query) {
      this.requests.delete(id)
      this.cancel(id)
    }
    if (this.sent.get(id) === query) this.sent.delete(id)
  }

  private cancel(id: string): void {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
  }

  private request(id: string, query: Query): CachedRequest | undefined {
    const entry = this.requests.get(id)
    return entry?.query === query ? entry.last : undefined
  }

  private fire(id: string, query: Query): void {
    this.timers.delete(id)
    const live = this.host.live.get(id)
    if (!live || live.query !== query || this.sent.has(id)) return
    let session: ReturnType<IdleCompactorHost['get']>
    try {
      session = this.host.get(id)
    } catch {
      return // deleted meanwhile
    }
    if (session.provider !== 'claude-code' || session.parentId) return
    if (!idleCompactionWindow(this.mode(), this.request(id, query), Date.now())) return
    if (
      idleCompactionHeld({
        idle: session.state === 'idle',
        pendingRequests: live.pending.size > 0 || this.host.hasBlockingQuestions(id),
        backgroundWork: this.host.hasRunningTasks(id),
        queuedMessages: this.host.queued(id).length > 0,
        continuesOnItsOwn: goalContinues(this.host.getGoal(id)) || !!this.host.providerWait(id),
        done: this.host.threadDone(id),
        justCompacted: false,
      })
    )
      return
    this.sent.set(id, query)
    live.input.push('/compact')
  }

  /**
   * Claude's return prompt for a long thread, answered in the thread. `off` keeps the history without asking;
   * "Don't ask again" turns the setting off rather than Claude Code's own flag, so Settings stays the one switch.
   */
  resumeDialog(id: string, pending: Map<string, PendingRequest>): OnUserDialog {
    return async (request, { signal }) => {
      if (request.dialogKind !== 'resume_return') return { behavior: 'cancelled' }
      const mode = this.mode()
      if (mode === 'off') return { behavior: 'completed', result: 'continue' }
      const question = resumeCompactionQuestion(request.payload, mode)
      const requestId = randomUUID()
      const answer = await new Promise<PermissionResult>((resolve) => {
        pending.set(requestId, { kind: 'question', input: { questions: [question] }, resolve })
        signal.addEventListener(
          'abort',
          () => {
            if (!pending.delete(requestId)) return
            this.host.record(id, { kind: 'request-resolved', requestId, outcome: 'cancelled' })
            resolve({ behavior: 'deny', message: 'Claude stopped waiting for this answer.' })
          },
          { once: true },
        )
        this.host.record(id, { kind: 'question', requestId, questions: [question] })
        this.host.setState(id, 'needs-input')
      })
      if (answer.behavior !== 'allow') return { behavior: 'cancelled' }
      const answers = answer.updatedInput?.answers as Record<string, string> | undefined
      const choice = resumeCompactionChoice(answers?.[question.question])
      if (choice === 'never') {
        const preferences = this.host.preferences()
        if (preferences) this.host.savePreferences()?.({ ...preferences, idleCompaction: 'off' })
      }
      if (choice === 'compact') this.chosen.add(id)
      return { behavior: 'completed', result: choice === 'compact' ? 'compact' : 'continue' }
    }
  }
}
