import type {
  AgentEvent,
  AgentSessionInfo,
  AgentProvider,
  AgentSettings,
  AppPreferences,
  ProviderCatalog,
} from '@ramu/shared/types'
import { providerAccountOrder } from '@ramu/shared/providers/providers'
import { effectiveAutoResume, type LimitRetryResult } from '@ramu/shared/chat/providerWait'
import { goalContinues, isLimitHold, isUserPaused } from '@ramu/shared/chat/goalHold'
import { resolveStep, isOver, peakFor } from '@ramu/shared/providers/routing'
import { goalContinuation } from './goals'
import { WRITING_STATES } from './constants'
import type { MessageDispatcher } from './messageDispatcher'
import type { GoalManager } from './goalManager'
import type { SessionProcess } from './sessionProcess'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { UserRequests } from './userRequests'
import type { FallbackRouter } from './fallbackRouter'
import type { SessionStarter } from './sessionStarter'
import type { SessionStore } from './sessionStore'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** What ProviderWaits needs from the rest of the service. */
export interface ProviderWaitsHost
  extends
    Pick<MessageDispatcher, 'dispatchQueued' | 'startingSends' | 'workspaceBusy'>,
    Pick<GoalManager, 'getGoal' | 'saveGoal'>,
    Pick<SessionProcess, 'fail' | 'halt'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<SessionRegistry, 'finalizing' | 'transitioning'>,
    Pick<UserRequests, 'hasBlockingQuestions'>,
    Pick<FallbackRouter, 'orderOf' | 'policyOf' | 'routing'>,
    Pick<SessionStarter, 'send'>,
    Pick<SessionStore, 'emit' | 'events' | 'get' | 'hasRunningTasks' | 'latestEvent' | 'queuePaused' | 'queued'> {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  preferences(): AppPreferences | undefined
  refreshAccountUsage(): AgentService['refreshAccountUsage']
  shutdown(): AgentService['shutdown']
}

/** The prompt that picks a chat up again after a limit when nothing was queued. */
export const LIMIT_CONTINUATION =
  'Continue the unfinished request. Inspect current files and tool results first to avoid repeating completed work.'

/** Random spread applied when several threads resume from one shared limit, so they do not all trip it at once. */
export interface WaitSpread {
  /** The most a thread is held back, however many share the limit. */
  maxMs: number
  /** How much each extra thread widens the window. */
  perThreadMs: number
  random: () => number
}

type ProviderWaitEvent = Extract<AgentEvent, { kind: 'provider-wait' }>

/** Threads waiting on one provider login share a timer and one availability pass. */
interface WaitGroup {
  timer: NodeJS.Timeout
  dueAt: number
  ids: Set<string>
}

const MAX_TIMEOUT = 2 ** 31 - 1

/**
 * A chat that hit a usage limit with nothing to fall back to waits durably and retries when the provider has room again.
 * Waits are keyed by provider login: threads on the same limit share one timer, check availability once and resume with a
 * small random spread. Whether a wait resumes on its own is the thread's `autoResume`, else the global default, read each
 * time a timer is scheduled or fires; with it off the wait is recorded for display and only a reset notice is scheduled.
 */
export class ProviderWaits {
  constructor(
    private readonly host: ProviderWaitsHost,
    private readonly db: Db,
  ) {}

  /** Tests may tighten this; a single waiter is never delayed. */
  spread: WaitSpread = { maxMs: 15_000, perThreadMs: 1_000, random: Math.random }

  private readonly groups = new Map<string, WaitGroup>()

  private readonly groupOf = new Map<string, string>()

  private readonly resumeTimers = new Map<string, NodeJS.Timeout>()

  private readonly noticeTimers = new Map<string, NodeJS.Timeout>()

  private readonly providerDispatching = new Set<string>()

  providerWait(id: string): ProviderWaitEvent | null {
    const event = this.host.latestEvent(id, 'provider-wait')
    return event && event.retryAt !== null ? event : null
  }

  /** Whether a thread at a limit continues by itself: its own choice, else its parent's, else the live global default. */
  autoResumeOf(id: string): boolean {
    const session = this.host.get(id)
    const parent = session.parentId ? this.host.get(session.parentId) : undefined
    return effectiveAutoResume(session.settings, this.host.preferences()?.fallback, parent?.settings).value
  }

  private keyOf(session: Pick<AgentSessionInfo, 'provider' | 'settings'>): string {
    return `${session.provider}:${session.settings.accountId ?? 'default'}`
  }

  /** Queues the thread's retry on its login's shared timer. With auto-resume off nothing is retried, only the reset is announced. */
  scheduleProvider(id: string, delay = 1000): void {
    if (this.host.shutdown()) return
    if (!this.autoResumeOf(id)) {
      this.unschedule(id)
      this.scheduleNotice(id)
      return
    }
    const key = this.keyOf(this.host.get(id))
    const previous = this.groupOf.get(id)
    if (previous && previous !== key) this.leave(id)
    const due = Date.now() + delay
    const existing = this.groups.get(key)
    if (existing) {
      existing.ids.add(id)
      this.groupOf.set(id, key)
      // A thread that is due sooner pulls the shared timer forward; later ones ride along.
      if (due >= existing.dueAt) return
      clearTimeout(existing.timer)
      existing.dueAt = due
      existing.timer = this.arm(key, delay)
      return
    }
    this.groups.set(key, { timer: this.arm(key, delay), dueAt: due, ids: new Set([id]) })
    this.groupOf.set(id, key)
  }

  private arm(key: string, delay: number): NodeJS.Timeout {
    return setTimeout(() => void this.fireGroup(key), delay).unref()
  }

  private leave(id: string): void {
    const key = this.groupOf.get(id)
    this.groupOf.delete(id)
    const group = key ? this.groups.get(key) : undefined
    if (!group) return
    group.ids.delete(id)
    if (!group.ids.size) {
      clearTimeout(group.timer)
      this.groups.delete(key!)
    }
  }

  /** Drops every pending retry and notice for one thread, without touching the recorded wait. */
  private unschedule(id: string): void {
    this.leave(id)
    clearTimeout(this.resumeTimers.get(id))
    this.resumeTimers.delete(id)
    clearTimeout(this.noticeTimers.get(id))
    this.noticeTimers.delete(id)
  }

  /** The shared timer fired: one catalog read, one availability pass per thread, then resumes with a random spread. */
  private async fireGroup(key: string): Promise<void> {
    const group = this.groups.get(key)
    if (!group) return
    this.groups.delete(key)
    const ids = [...group.ids]
    for (const id of ids) this.groupOf.delete(id)
    if (this.host.shutdown()) return
    let catalogs: ProviderCatalog[]
    try {
      catalogs = await this.host.catalog()
    } catch (error) {
      for (const id of ids) this.giveUp(id, error)
      return
    }
    const ready: string[] = []
    for (const id of ids) {
      try {
        const verdict = this.check(id, catalogs)
        if (verdict === 'go') ready.push(id)
        else if (verdict !== 'drop') this.scheduleProvider(id, verdict)
      } catch (error) {
        this.giveUp(id, error)
      }
    }
    // The first thread goes at once; the rest are spread over a window that grows with their number.
    const window = Math.min(this.spread.maxMs, this.spread.perThreadMs * Math.max(0, ready.length - 1))
    ready.forEach((id, index) => {
      const delay = index === 0 ? 0 : Math.floor(this.spread.random() * window)
      if (delay <= 0) {
        void this.resume(id).catch((error) => this.giveUp(id, error))
        return
      }
      this.resumeTimers.set(
        id,
        setTimeout(() => {
          this.resumeTimers.delete(id)
          void this.resume(id).catch((error) => this.giveUp(id, error))
        }, delay).unref(),
      )
    })
  }

  private giveUp(id: string, error: unknown): void {
    if (this.host.shutdown()) return
    this.clearProviderWait(id)
    this.host.fail(id, error)
  }

  clearProviderWait(id: string): void {
    this.unschedule(id)
    if (this.providerWait(id)) this.host.record(id, { kind: 'provider-wait', retryAt: null, updatedAt: Date.now() })
  }

  /** Reasons a held thread cannot be continued yet. */
  private busy(id: string, session: AgentSessionInfo, manual = false): boolean {
    // A paused queue only protects messages waiting in it; an empty one must not strand the unfinished request.
    const held = !manual && this.host.queuePaused(id) && this.host.queued(id).length > 0
    return (
      held ||
      WRITING_STATES.includes(session.state) ||
      this.host.transitioning.has(id) ||
      this.host.startingSends.has(id) ||
      this.host.workspaceBusy(session.covers, id) ||
      this.host.hasBlockingQuestions(id) ||
      this.host.hasRunningTasks(id)
    )
  }

  /** The models a held thread could continue on: its own, and the fallback order when it may switch. */
  private candidates(
    session: AgentSessionInfo,
    catalogs: ProviderCatalog[],
  ): Pick<AgentSettings, 'provider' | 'model' | 'accountId'>[] {
    const prefs = this.host.preferences()
    const steps = [
      session.settings,
      ...(session.settings.autoFallback ? this.host.policyOf(session, catalogs, prefs).order : []),
    ]
    return steps.flatMap((step) => {
      const model = resolveStep({ ...step, id: 'retry', effort: null }, catalogs)?.model ?? step.model
      const own =
        step.provider === session.provider
          ? (session.settings.accountId ?? 'default')
          : (providerAccountOrder(prefs?.providerBinaries, step.provider)[0] ?? 'default')
      const accounts = session.settings.autoFallback
        ? [...new Set([own, ...providerAccountOrder(prefs?.providerBinaries, step.provider)])]
        : [own]
      return accounts.map((accountId) => ({ provider: step.provider, model, accountId }))
    })
  }

  /** Whether a candidate login gained room since the wait began. */
  private roomSince(session: AgentSessionInfo, catalogs: ProviderCatalog[], wait: ProviderWaitEvent): boolean {
    const all = this.host.routing(session.settings)?.all ?? []
    return this.candidates(session, catalogs).some((step) => {
      const readings = all.filter((reading) => (reading.accountId ?? 'default') === step.accountId)
      return (
        !!resolveStep({ ...step, id: 'retry', effort: null }, catalogs) &&
        readings.some(
          (r) =>
            r.provider === step.provider &&
            (r.updatedAt > wait.updatedAt || (!!r.resetsAt && r.resetsAt > wait.updatedAt && r.resetsAt <= Date.now())),
        ) &&
        !isOver(peakFor(readings, step.provider, step.model), null)
      )
    })
  }

  /** What the timer does for one thread: retry now, drop it, or look again after a delay. */
  private check(id: string, catalogs: ProviderCatalog[]): 'go' | 'drop' | number {
    const wait = this.providerWait(id)
    if (this.host.shutdown() || !wait || this.providerDispatching.has(id)) return 'drop'
    if (!this.autoResumeOf(id)) {
      this.scheduleNotice(id)
      return 'drop'
    }
    const session = this.host.get(id)
    if (this.busy(id, session)) return 1000
    if (!this.roomSince(session, catalogs, wait) && wait.retryAt! > Date.now())
      return Math.min(60_000, wait.retryAt! - Date.now())
    return 'go'
  }

  /** Continues a held thread: sends its queued messages, or the unfinished request. False when it could not go yet. */
  private async resume(id: string, manual = false): Promise<boolean> {
    const wait = this.providerWait(id)
    if (this.host.shutdown() || !wait || this.providerDispatching.has(id)) return false
    if (!manual && !this.autoResumeOf(id)) {
      this.scheduleNotice(id)
      return false
    }
    const session = this.host.get(id)
    if (this.busy(id, session, manual)) {
      if (!manual) this.scheduleProvider(id)
      return false
    }
    this.providerDispatching.add(id)
    try {
      await this.host.finalizing.get(id)
      if (this.host.shutdown() || this.providerWait(id)?.updatedAt !== wait.updatedAt) return false
      if (!manual && this.host.queuePaused(id) && this.host.queued(id).length) {
        this.scheduleProvider(id)
        return false
      }
      this.clearProviderWait(id)
      const goal = this.host.getGoal(id)
      if (isLimitHold(goal))
        this.host.saveGoal(id, {
          ...goal!,
          status: 'active',
          pausedBy: undefined,
          retryAt: undefined,
          updatedAt: Date.now(),
        })
      // A goal the user paused while the thread was at the limit stays paused: only their queued messages go out.
      if (this.host.queued(id).length) await this.host.dispatchQueued(id, true)
      else if (!isUserPaused(goal))
        await this.host.send(
          id,
          goal ? goalContinuation(goal) : LIMIT_CONTINUATION,
          [],
          undefined,
          false,
          undefined,
          true,
        )
      return true
    } finally {
      this.providerDispatching.delete(id)
    }
  }

  /**
   * "Try again" for a held thread: re-checks usage and sends the continuation only if a reading shows room or the provider
   * has no usage reading of its own. A reading Ramu inferred from a limit notice proves a limit, never room, so it cannot
   * block the attempt. Otherwise the thread stays in the wait with the updated reset time and no failed turn.
   */
  async retryLimitNow(id: string): Promise<LimitRetryResult> {
    const wait = this.providerWait(id)
    if (!wait || this.host.shutdown()) return { resumed: false, retryAt: null, guessed: false }
    const still = (current: ProviderWaitEvent | null): LimitRetryResult => ({
      resumed: false,
      retryAt: current?.retryAt ?? null,
      guessed: !!current?.guessed,
    })
    const session = this.host.get(id)
    if (this.providerDispatching.has(id) || this.busy(id, session, true)) return still(wait)
    await this.refreshUsage(session.provider)
    const catalogs = await this.host.catalog()
    if (this.host.shutdown() || this.providerWait(id)?.updatedAt !== wait.updatedAt) return still(this.providerWait(id))
    const live = this.host.get(id)
    const all = this.host.routing(live.settings)?.all ?? []
    const real = all.filter((reading) => reading.source !== 'notice')
    const roomOrBlind = this.candidates(live, catalogs).some((step) => {
      if (
        !resolveStep({ ...(step as { provider: AgentProvider; model: string }), id: 'retry', effort: null }, catalogs)
      )
        return false
      // No reading of its own: the only way to learn is to try.
      const own = real.filter((reading) => (reading.accountId ?? 'default') === step.accountId)
      if (!own.some((reading) => reading.provider === step.provider)) return true
      return !isOver(peakFor(own, step.provider, step.model), null)
    })
    if (roomOrBlind) {
      const resumed = await this.resume(id, true)
      // Not sent (the thread was busy): it is still held, so report the wait it is in.
      return resumed ? { resumed, retryAt: null, guessed: false } : still(this.providerWait(id))
    }
    // Still limited: keep the wait with the latest reset the readings give, and keep the timer going.
    const now = Date.now()
    const resets = this.candidates(live, catalogs)
      .map((step) =>
        peakFor(
          all.filter((reading) => (reading.accountId ?? 'default') === step.accountId),
          step.provider,
          step.model,
          now,
        ),
      )
      .filter((reading) => isOver(reading, null) && reading?.resetsAt && reading.resetsAt > now)
      .map((reading) => reading!.resetsAt!)
    const retryAt = resets.length ? Math.min(...resets) + 1000 : wait.retryAt!
    const guessed = resets.length ? false : !!wait.guessed
    this.host.record(id, {
      kind: 'provider-wait',
      retryAt,
      ...(wait.retryDelay ? { retryDelay: wait.retryDelay } : {}),
      updatedAt: now,
      guessed,
      provider: live.provider,
      accountId: live.settings.accountId ?? 'default',
    })
    const goal = this.host.getGoal(id)
    if (goal && isLimitHold(goal)) this.host.saveGoal(id, { ...goal, retryAt, updatedAt: now })
    this.scheduleProvider(id, Math.min(60_000, Math.max(1000, retryAt - now)))
    return { resumed: false, retryAt, guessed }
  }

  /** Waits briefly for a current reading of the provider's usage; a slow read never holds up the user. */
  private async refreshUsage(provider: AgentProvider): Promise<void> {
    const refresh = this.host.refreshAccountUsage()
    if (!refresh) return
    await Promise.race([
      refresh(provider).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 8_000).unref()),
    ])
  }

  /**
   * A quota failure keeps the chat durable instead of failing it: with fallback off the chat resumes on the same provider
   * once the limit resets, and a goal waits the same way. Known resets schedule a retry; unknown resets back off. This
   * covers sub-agents too, so a helper at a limit waits with its login instead of failing. Returns false only at shutdown.
   */
  waitForGoalProvider(id: string, reason?: string): boolean {
    if (this.host.shutdown()) return false
    const goal = this.host.getGoal(id)
    const session = this.host.get(id)
    const now = Date.now(),
      previous = this.providerWait(id)
    const readings = this.host.routing(session.settings)?.usage ?? []
    const order = session.settings.autoFallback ? this.host.orderOf([], this.host.preferences()) : []
    const resets = [session.settings, ...order]
      .map((step) => {
        const applicable = readings.filter(
          (r) => r.provider === step.provider && peakFor([r], step.provider, step.model, now) && isOver(r, null),
        )
        return applicable.length && applicable.every((r) => r.resetsAt)
          ? Math.max(...applicable.map((r) => r.resetsAt!))
          : 0
      })
      .filter((reset) => reset > now)
    const retryDelay = Math.min(15 * 60_000, Math.max(60_000, (previous?.retryDelay ?? goal?.retryDelay ?? 30_000) * 2))
    const retryAt = resets.length ? Math.min(...resets) + 1000 : now + retryDelay
    const automatic = this.autoResumeOf(id)
    this.host.record(id, {
      kind: 'provider-wait',
      retryAt,
      retryDelay,
      updatedAt: now,
      guessed: !resets.length,
      provider: session.provider,
      accountId: session.settings.accountId ?? 'default',
      ...(reason ? { reason } : {}),
    })
    // Only an active goal, or one already held by a limit, becomes a limit hold: a goal the user paused stays theirs.
    if (goal && goalContinues(goal))
      this.host.saveGoal(id, {
        ...goal,
        status: 'paused',
        pausedBy: 'provider-limit',
        retryAt,
        retryDelay,
        reason: automatic
          ? 'Waiting for provider availability after a usage limit. Ramu will resume automatically.'
          : 'Usage limit reached. Auto-resume is off, so resume the goal when you are ready.',
        updatedAt: now,
      })
    this.scheduleProvider(id)
    this.host.halt(id)
    this.host.setState(id, 'idle')
    return true
  }

  /** Sets or clears this thread's own auto-resume choice, then re-arms its wait and its helpers' waits at once. */
  setAutoResume(id: string, value: boolean | null): AgentSessionInfo {
    const session = this.host.get(id)
    const { autoResume: _previous, ...rest } = session.settings
    const settings: AgentSettings = value === null ? rest : { ...rest, autoResume: value }
    this.db.prepare('UPDATE agent_sessions SET settings = ? WHERE id = ?').run(JSON.stringify(settings), id)
    const children = this.db.prepare('SELECT id FROM agent_sessions WHERE parent_session_id = ?').all(id) as {
      id: string
    }[]
    for (const target of [id, ...children.map((child) => child.id)]) this.rearm(target)
    const updated = this.host.get(id)
    // Other windows read the session again on a state event; the state itself does not change.
    this.host.emit(id, { kind: 'state', state: updated.state })
    return updated
  }

  private rearm(id: string): void {
    if (!this.providerWait(id)) return
    this.unschedule(id)
    this.scheduleProvider(id)
  }

  /** Re-arms every open wait after startup or a settings change: turned on schedules, turned off drops the retry. */
  settingsChanged(): void {
    if (this.host.shutdown()) return
    const rows = this.db
      .prepare(
        `SELECT s.id FROM agent_sessions s WHERE (SELECT json_extract(e.event, '$.retryAt') FROM agent_events e WHERE e.session_id = s.id AND json_extract(e.event, '$.kind') = 'provider-wait' ORDER BY e.seq DESC LIMIT 1) IS NOT NULL`,
      )
      .all() as { id: string }[]
    for (const { id } of rows) this.rearm(id)
  }

  /** With auto-resume off, the user is told once when a known reset passes, since nothing will continue the thread. */
  private scheduleNotice(id: string): void {
    clearTimeout(this.noticeTimers.get(id))
    this.noticeTimers.delete(id)
    const wait = this.providerWait(id)
    if (!wait || wait.guessed || wait.resetNotifiedAt !== undefined || this.host.shutdown()) return
    const delay = Math.min(Math.max(0, wait.retryAt! - Date.now()) + 1000, MAX_TIMEOUT)
    this.noticeTimers.set(
      id,
      setTimeout(() => {
        this.noticeTimers.delete(id)
        const current = this.providerWait(id)
        if (this.host.shutdown() || !current || current.updatedAt !== wait.updatedAt || this.autoResumeOf(id)) return
        if (current.retryAt! > Date.now()) {
          this.scheduleNotice(id)
          return
        }
        const { at: _at, ...fields } = current
        this.host.record(id, { ...fields, resetNotifiedAt: Date.now() })
      }, delay).unref(),
    )
  }

  /** Drops every pending retry timer, as on shutdown. */
  clearProviderTimers(): void {
    for (const group of this.groups.values()) clearTimeout(group.timer)
    this.groups.clear()
    this.groupOf.clear()
    for (const timer of [...this.resumeTimers.values(), ...this.noticeTimers.values()]) clearTimeout(timer)
    this.resumeTimers.clear()
    this.noticeTimers.clear()
  }
}
