import type { AppPreferences, ProviderCatalog } from '@ramu/shared/types'
import { resolveStep, isOver, peakFor } from '@ramu/shared/routing'
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
    Pick<SessionStore, 'events' | 'get' | 'hasRunningTasks' | 'queuePaused' | 'queued'> {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  preferences(): AppPreferences | undefined
  shutdown(): AgentService['shutdown']
}

/** A chat that hit a usage limit with nothing to fall back to waits durably and retries when the provider has room again. */
export class ProviderWaits {
  constructor(private readonly host: ProviderWaitsHost) {}

  private readonly providerTimers = new Map<string, NodeJS.Timeout>()

  private readonly providerDispatching = new Set<string>()

  providerWait(id: string) {
    const event = this.host.events(id).findLast((event) => event.kind === 'provider-wait')
    return event?.kind === 'provider-wait' && event.retryAt !== null ? event : null
  }

  scheduleProvider(id: string, delay = 1000): void {
    if (this.host.shutdown() || this.providerTimers.has(id)) return
    this.providerTimers.set(
      id,
      setTimeout(() => {
        this.providerTimers.delete(id)
        void this.retryProvider(id).catch((error) => {
          if (!this.host.shutdown()) {
            this.clearProviderWait(id)
            this.host.fail(id, error)
          }
        })
      }, delay).unref(),
    )
  }

  clearProviderWait(id: string): void {
    const timer = this.providerTimers.get(id)
    if (timer) clearTimeout(timer)
    this.providerTimers.delete(id)
    if (this.providerWait(id)) this.host.record(id, { kind: 'provider-wait', retryAt: null, updatedAt: Date.now() })
  }

  private async retryProvider(id: string): Promise<void> {
    const wait = this.providerWait(id)
    if (this.host.shutdown() || !wait || this.providerDispatching.has(id)) return
    const session = this.host.get(id)
    // A paused queue only protects messages waiting in it; an empty one must not strand the unfinished request.
    const held = () => this.host.queuePaused(id) && this.host.queued(id).length > 0
    if (
      held() ||
      WRITING_STATES.includes(session.state) ||
      this.host.transitioning.has(id) ||
      this.host.startingSends.has(id) ||
      this.host.workspaceBusy(session.covers, id) ||
      this.host.hasBlockingQuestions(id) ||
      this.host.hasRunningTasks(id)
    ) {
      this.scheduleProvider(id)
      return
    }
    const readings = this.host.routing(session.settings)?.usage ?? []
    const catalogs = await this.host.catalog()
    if (this.host.shutdown() || (this.providerWait(id) !== wait && this.providerWait(id)?.updatedAt !== wait.updatedAt))
      return
    const candidates = [
      session.settings,
      ...(session.settings.autoFallback ? this.host.policyOf(session, catalogs, this.host.preferences()).order : []),
    ]
    const available = candidates.some(
      (step) =>
        resolveStep({ ...step, id: 'retry' }, catalogs) &&
        readings.some(
          (r) =>
            r.provider === step.provider &&
            (r.updatedAt > wait.updatedAt || (!!r.resetsAt && r.resetsAt > wait.updatedAt && r.resetsAt <= Date.now())),
        ) &&
        !isOver(peakFor(readings, step.provider, step.model), null),
    )
    if (!available && wait.retryAt! > Date.now()) {
      this.scheduleProvider(id, Math.min(60_000, wait.retryAt! - Date.now()))
      return
    }
    this.providerDispatching.add(id)
    try {
      await this.host.finalizing.get(id)
      if (this.host.shutdown() || this.providerWait(id)?.updatedAt !== wait.updatedAt || held()) return
      this.clearProviderWait(id)
      const goal = this.host.getGoal(id)
      if (goal?.status === 'waiting-provider')
        this.host.saveGoal(id, { ...goal, status: 'active', retryAt: undefined, updatedAt: Date.now() })
      if (this.host.queued(id).length) await this.host.dispatchQueued(id, true)
      else
        await this.host.send(
          id,
          goal
            ? goalContinuation(goal)
            : 'Continue the unfinished request. Inspect current files and tool results first to avoid repeating completed work.',
          [],
          undefined,
          false,
          undefined,
          true,
        )
    } finally {
      this.providerDispatching.delete(id)
    }
  }

  /** A quota failure keeps the goal durable. Known resets schedule a retry; unknown resets back off. */
  waitForGoalProvider(id: string): boolean {
    const goal = this.host.getGoal(id)
    const session = this.host.get(id)
    if (session.parentId || (!session.settings.autoFallback && !goal)) return false
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
    this.host.record(id, { kind: 'provider-wait', retryAt, retryDelay, updatedAt: now })
    if (goal && ['active', 'waiting-provider'].includes(goal.status))
      this.host.saveGoal(id, {
        ...goal,
        status: 'waiting-provider',
        retryAt,
        retryDelay,
        reason: 'Waiting for provider availability after a usage limit. Ramu will resume automatically.',
        updatedAt: now,
      })
    this.scheduleProvider(id)
    this.host.halt(id)
    this.host.setState(id, 'idle')
    return true
  }

  /** Drops every pending retry timer, as on shutdown. */
  clearProviderTimers(): void {
    for (const timer of this.providerTimers.values()) clearTimeout(timer)
    this.providerTimers.clear()
  }
}
