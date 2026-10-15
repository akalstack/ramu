import { randomUUID } from 'node:crypto'
import {
  type AppPreferences,
  type AgentEvent,
  type ProviderCatalog,
  DEFAULT_GOAL_PREFERENCES,
  type ChatGoal,
} from '@ramu/shared/types'
import { isOver, peakFor } from '@ramu/shared/routing'
import { goalContinuation } from './goals'
import { WRITING_STATES } from './constants'
import { errorMessage } from './util'
import type { MessageDispatcher } from './messageDispatcher'
import type { ProviderWaits } from './providerWait'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { UserRequests } from './userRequests'
import type { FallbackRouter } from './fallbackRouter'
import type { SessionStarter } from './sessionStarter'
import type { SessionStore } from './sessionStore'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** What GoalManager needs from the rest of the service. */
export interface GoalManagerHost
  extends
    Pick<MessageDispatcher, 'steering' | 'updateQueue' | 'workspaceBusy'>,
    Pick<ProviderWaits, 'providerWait' | 'scheduleProvider'>,
    Pick<SessionRecorder, 'record'>,
    Pick<SessionRegistry, 'finalizing' | 'revisions' | 'transitioning'>,
    Pick<UserRequests, 'hasBlockingQuestions'>,
    Pick<FallbackRouter, 'policyOf'>,
    Pick<SessionStarter, 'send'>,
    Pick<SessionStore, 'get' | 'hasRunningTasks' | 'isRecoveryPending' | 'queuePaused' | 'queued'> {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  preferences(): AppPreferences | undefined
  shutdown(): AgentService['shutdown']
  usage(): AgentService['usage']
}

/** Chat goals: the durable goal record, its commands, and the timer that continues an active goal turn by turn. */
export class GoalManager {
  constructor(
    private readonly host: GoalManagerHost,
    private readonly db: Db,
  ) {}

  private readonly goalTimers = new Map<string, NodeJS.Timeout>()

  private readonly goalDispatching = new Set<string>()

  getGoal(id: string): ChatGoal | null {
    this.host.get(id)
    const row = this.db
      .prepare(
        "SELECT event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'goal' ORDER BY seq DESC LIMIT 1",
      )
      .get(id) as { event: string } | undefined
    return row ? (JSON.parse(row.event) as Extract<AgentEvent, { kind: 'goal' }>).goal : null
  }

  goalPreferences() {
    return this.host.preferences()?.goals ?? DEFAULT_GOAL_PREFERENCES
  }

  saveGoal(id: string, goal: ChatGoal | null): ChatGoal | null {
    const timer = this.goalTimers.get(id)
    if (timer) clearTimeout(timer)
    this.goalTimers.delete(id)
    this.host.record(id, { kind: 'goal', goal })
    if (goal && ['active', 'waiting-provider'].includes(goal.status)) this.scheduleGoal(id)
    return goal
  }

  setGoal(id: string, objective: string, fromUser = false): ChatGoal {
    const session = this.host.get(id),
      current = this.getGoal(id),
      prefs = this.goalPreferences()
    if (session.parentId) throw new Error('Goals belong to main chats.')
    if (!fromUser && prefs.mode === 'manual' && !current)
      throw new Error('Manual mode requires the user to start a goal with /goal.')
    if (!fromUser && current && ['paused', 'turn-limit', 'waiting-provider'].includes(current.status))
      throw new Error('Only the user can resume this goal.')
    if (!objective.trim() || objective.length > 8000) throw new Error('Enter a goal of at most 8000 characters.')
    const reuse = current && !['completed'].includes(current.status)
    const goal: ChatGoal = {
      id: reuse ? current.id : randomUUID(),
      objective: objective.trim(),
      status: 'active',
      turns: reuse ? current.turns : 0,
      reason: reuse ? current.reason : '',
      updatedAt: Date.now(),
    }
    return this.saveGoal(id, goal)!
  }

  updateGoal(id: string, status: 'active' | 'completed' | 'blocked', reason: string): ChatGoal {
    const goal = this.getGoal(id)
    if (!goal || !['active', 'blocked'].includes(goal.status))
      throw new Error('No active goal. Only the user can resume a paused goal.')
    if (!reason.trim() || reason.length > 8000)
      throw new Error('Include unfinished work, completion evidence, or the blocker.')
    if (
      status === 'completed' &&
      (this.host.hasBlockingQuestions(id) || this.host.hasRunningTasks(id) || this.host.queued(id).length)
    )
      throw new Error('Wait for required input, queued instructions and running helpers before declaring completion.')
    return this.saveGoal(id, { ...goal, status, reason: reason.trim(), updatedAt: Date.now() })!
  }

  controlGoal(id: string, action: 'pause' | 'resume' | 'clear'): ChatGoal | null {
    const goal = this.getGoal(id)
    if (action === 'clear') return this.saveGoal(id, null)
    if (!goal) throw new Error('This chat has no goal.')
    if (action === 'resume' && goal.status === 'completed')
      throw new Error('This goal is already complete. Start a new goal.')
    if (action === 'resume') this.host.updateQueue(id, this.host.queued(id), false)
    return this.saveGoal(id, {
      ...goal,
      status: action === 'pause' ? 'paused' : 'active',
      turns: action === 'resume' && goal.status === 'turn-limit' ? 0 : goal.turns,
      retryAt: undefined,
      retryDelay: undefined,
      updatedAt: Date.now(),
    })
  }

  /** Re-arm durable goals after startup or settings changes; no inference happens here. */
  goalsSettingsChanged(): void {
    for (const timer of this.goalTimers.values()) clearTimeout(timer)
    this.goalTimers.clear()
    if (this.host.shutdown()) return
    for (const { id } of this.db.prepare('SELECT id FROM agent_sessions WHERE parent_session_id IS NULL').all() as {
      id: string
    }[]) {
      if (this.host.providerWait(id)) this.host.scheduleProvider(id)
      const goal = this.getGoal(id)
      if (
        goal?.status === 'turn-limit' &&
        (this.goalPreferences().maxTurns === null || goal.turns < this.goalPreferences().maxTurns!)
      ) {
        this.saveGoal(id, { ...goal, status: 'active', reason: 'Continuation limit increased.', updatedAt: Date.now() })
        continue
      }
      if (goal && ['active', 'waiting-provider'].includes(goal.status)) this.scheduleGoal(id)
    }
  }

  scheduleGoal(id: string, delay = 1000): void {
    if (this.host.shutdown() || this.goalTimers.has(id)) return
    const timer = setTimeout(() => {
      this.goalTimers.delete(id)
      void this.continueGoal(id).catch((error) => {
        if (this.host.shutdown()) return
        const goal = this.getGoal(id)
        if (goal?.status === 'active')
          this.saveGoal(id, {
            ...goal,
            status: 'blocked',
            reason: `Could not continue: ${errorMessage(error)}`,
            updatedAt: Date.now(),
          })
      })
    }, delay).unref()
    this.goalTimers.set(id, timer)
  }

  private async continueGoal(id: string): Promise<void> {
    let goal = this.getGoal(id)
    if (
      this.host.shutdown() ||
      this.host.providerWait(id) ||
      !goal ||
      !['active', 'waiting-provider'].includes(goal.status)
    )
      return
    if (this.goalDispatching.has(id)) return
    const session = this.host.get(id)
    if (WRITING_STATES.includes(session.state)) return // The next terminal state re-arms the goal.
    if (
      this.host.queuePaused(id) ||
      this.host.queued(id).length ||
      this.host.steering.has(id) ||
      this.host.transitioning.has(id) ||
      this.host.isRecoveryPending(id) ||
      this.host.hasBlockingQuestions(id) ||
      this.host.hasRunningTasks(id) ||
      this.host.workspaceBusy(session.covers, id)
    ) {
      this.scheduleGoal(id, 1000)
      return
    }
    const cap = this.goalPreferences().maxTurns
    if (goal.status !== 'waiting-provider' && cap !== null && goal.turns >= cap) {
      this.saveGoal(id, {
        ...goal,
        status: 'turn-limit',
        reason: `Reached ${cap} automatic continuation turns. Resume to allow another batch, or change the limit in Settings.`,
        updatedAt: Date.now(),
      })
      return
    }
    const readings = this.host.usage()?.list({ [session.provider]: session.settings.accountId ?? 'default' }) ?? []
    let freshAvailability =
      readings.some(
        (r) =>
          r.provider === session.provider &&
          (r.updatedAt > goal!.updatedAt || (r.resetsAt && r.resetsAt > goal!.updatedAt && r.resetsAt <= Date.now())),
      ) && !isOver(peakFor(readings, session.provider, session.settings.model), null)
    if (goal.status === 'waiting-provider' && session.settings.autoFallback && !freshAvailability && readings.length) {
      const order = this.host.policyOf(session, await this.host.catalog(), this.host.preferences()).order
      freshAvailability = order.some(
        (step) =>
          readings.some(
            (r) =>
              r.provider === step.provider &&
              (r.updatedAt > goal!.updatedAt ||
                (r.resetsAt && r.resetsAt > goal!.updatedAt && r.resetsAt <= Date.now())),
          ) &&
          !isOver(peakFor(readings, step.provider, step.model), this.host.preferences()?.fallback.switchAt ?? null),
      )
    }
    if (goal.status === 'waiting-provider' && !freshAvailability && (goal.retryAt ?? 0) > Date.now()) {
      this.scheduleGoal(id, Math.min(60_000, goal.retryAt! - Date.now()))
      return
    }
    this.goalDispatching.add(id)
    const revision = this.host.revisions.get(id) ?? 0
    try {
      await this.host.finalizing.get(id)
      goal = this.getGoal(id)
      if (
        this.host.shutdown() ||
        !goal ||
        !['active', 'waiting-provider'].includes(goal.status) ||
        revision !== (this.host.revisions.get(id) ?? 0) ||
        this.host.queued(id).length ||
        this.host.queuePaused(id) ||
        this.host.workspaceBusy(session.covers, id)
      ) {
        this.scheduleGoal(id)
        return
      }
      const retry = goal.status === 'waiting-provider'
      const next = {
        ...goal,
        status: 'active' as const,
        turns: goal.turns + (retry ? 0 : 1),
        retryAt: undefined,
        updatedAt: Date.now(),
      }
      this.saveGoal(id, next)
      await this.host.send(id, goalContinuation(next), [], undefined, false, { revision, goalId: goal.id })
    } finally {
      this.goalDispatching.delete(id)
    }
  }

  /** Drops every pending continuation timer, as on shutdown. */
  clearGoalTimers(): void {
    for (const timer of this.goalTimers.values()) clearTimeout(timer)
    this.goalTimers.clear()
  }
}
