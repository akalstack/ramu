import { createHash, randomUUID } from 'node:crypto'
import {
  type AppPreferences,
  type AgentEvent,
  type ProviderCatalog,
  DEFAULT_GOAL_PREFERENCES,
  goalTurnLimit,
  type ChatGoal,
  type GoalEvidence,
} from '@ramu/shared/types'
import { isOver, peakFor } from '@ramu/shared/providers/routing'
import { STALL_REASON } from '@ramu/shared/chat/goalHistory'
import { goalContinues, isLimitHold } from '@ramu/shared/chat/goalHold'
import { goalContinuation } from './goals'
import { changedSince, evidenceProblem, fingerprintOf, turnActivity, unlistedChanges } from './goalEvidence'
import type { GoalProbes, WorkspaceSnapshot } from './goalProbes'
import { redactSecrets } from '../memory/secrets'
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
    Pick<SessionStore, 'get' | 'hasRunningTasks' | 'isRecoveryPending' | 'queuePaused' | 'queued' | 'threadDone'> {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  goalProbes(): GoalProbes
  preferences(): AppPreferences | undefined
  shutdown(): AgentService['shutdown']
  usage(): AgentService['usage']
}

/** Continuations in a row that leave the workspace and the tool trail unchanged before the goal is blocked. */
const STALL_LIMIT = 2
const CHECK_OUTPUT = 4000
const clipTail = (text: string, max: number) => (text.length <= max ? text : `…${text.slice(-max)}`)

/** Chat goals: the durable goal record, its commands, and the timer that continues an active goal turn by turn. */
export class GoalManager {
  constructor(
    private readonly host: GoalManagerHost,
    private readonly db: Db,
  ) {}

  private readonly goalTimers = new Map<string, NodeJS.Timeout>()

  private readonly goalDispatching = new Set<string>()

  /** Verification commands in flight, so Stop, pause, clear and shutdown can end them. */
  private readonly verifying = new Map<string, AbortController>()

  /** The latest goal of each session, read once from the transcript and kept current by `saveGoal`, so list reads stay cheap. */
  private readonly latestGoals = new Map<string, ChatGoal | null>()

  /** A list row's view of a session's goal, without reading its transcript each time. */
  goalOf(id: string): ChatGoal | null {
    if (!this.latestGoals.has(id)) this.latestGoals.set(id, this.getGoal(id))
    return this.latestGoals.get(id) ?? null
  }

  /** Forget what was cached for a session whose events were removed, such as a rewind. */
  forgetGoal(id: string) {
    this.latestGoals.delete(id)
  }

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
    const before = this.getGoal(id)
    this.host.record(id, { kind: 'goal', goal })
    this.latestGoals.set(id, goal)
    if (!goal || goal.status === 'completed') this.endGoalTracking(id, before?.id)
    if (goal && goalContinues(goal)) this.scheduleGoal(id)
    return goal
  }

  private baselineKey = (goalId: string) => `goal-baseline:${goalId}`

  /** What the workspace looked like when the goal began, so only changes made during the goal need to be accounted for. */
  private async captureBaseline(id: string, goalId: string): Promise<void> {
    const snapshot = await this.host.goalProbes().snapshot(this.host.get(id).cwd)
    if (snapshot && this.getGoal(id)?.id === goalId)
      this.db
        .prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)')
        .run(this.baselineKey(goalId), JSON.stringify(snapshot.files))
  }

  private baseline(goalId: string): Record<string, string> | null {
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(this.baselineKey(goalId)) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as Record<string, string>) : null
  }

  private endGoalTracking(id: string, goalId?: string): void {
    this.verifying.get(id)?.abort()
    if (goalId) this.db.prepare('DELETE FROM app_state WHERE key = ?').run(this.baselineKey(goalId))
  }

  /** `verify` is a command only the user may set: Ramu runs it itself, which would otherwise sidestep the access mode. */
  setGoal(id: string, objective: string, fromUser = false, verify?: string): ChatGoal {
    const session = this.host.get(id),
      current = this.getGoal(id),
      prefs = this.goalPreferences()
    if (session.parentId) throw new Error('Goals belong to main threads.')
    if (!fromUser && prefs.mode === 'manual' && !current)
      throw new Error('Manual mode requires the user to start a goal with /goal.')
    if (!fromUser && current && ['paused', 'turn-limit'].includes(current.status))
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
      ...(reuse ? { verify: current.verify } : {}),
      ...(reuse && current.maxTurns !== undefined ? { maxTurns: current.maxTurns } : {}),
    }
    if (fromUser && verify !== undefined) goal.verify = this.cleanCommand(verify)
    if (!goal.verify) delete goal.verify
    this.verifying.get(id)?.abort()
    const saved = this.saveGoal(id, goal)!
    if (!reuse) void this.captureBaseline(id, saved.id).catch(() => {})
    return saved
  }

  private cleanCommand(command: string | null): string | undefined {
    const value = command?.trim()
    if (value && value.length > 2000) throw new Error('A verification command can be at most 2000 characters.')
    return value || undefined
  }

  /** The user sets, changes or removes the goal's verification command (`/goal verify: <command>`, `/goal verify: off`). */
  setVerify(id: string, command: string | null): ChatGoal {
    const goal = this.getGoal(id)
    if (!goal) throw new Error('This thread has no goal. Start one with /goal first.')
    if (goal.status === 'completed') throw new Error('This goal is already complete. Start a new goal.')
    const verify = this.cleanCommand(command)
    // A pending claim waits for the old command, so a change starts the claim over.
    const next: ChatGoal = { ...goal, claim: undefined, check: undefined, updatedAt: Date.now() }
    if (verify) next.verify = verify
    else delete next.verify
    this.verifying.get(id)?.abort()
    return this.saveGoal(id, next)!
  }

  /**
   * The person sets this goal's own limit on automatic turns: a number, null for none, or `default` to follow Settings.
   * A goal held at its limit carries on at once when the new limit leaves it room.
   */
  setTurnLimit(id: string, limit: number | null | 'default'): ChatGoal {
    const goal = this.getGoal(id)
    if (!goal) throw new Error('This thread has no goal. Start one with /goal first.')
    if (goal.status === 'completed') throw new Error('This goal is already complete. Start a new goal.')
    const next: ChatGoal = { ...goal, updatedAt: Date.now() }
    if (limit === 'default') delete next.maxTurns
    else next.maxTurns = limit
    const cap = goalTurnLimit(next, this.goalPreferences())
    if (next.status === 'turn-limit' && (cap === null || next.turns < cap)) {
      next.status = 'active'
      next.reason = 'Continuation limit increased.'
    }
    return this.saveGoal(id, next)!
  }

  /** Question drafts/answers update in place, so a sequence alone is not an input revision. */
  private inputState(id: string): string {
    const rows = this.db
      .prepare(
        "SELECT seq, event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') IN ('user', 'queue', 'question', 'question-state', 'permission-request', 'elicitation', 'request-resolved') ORDER BY seq",
      )
      .iterate(id) as Iterable<{ seq: number; event: string }>
    const hash = createHash('sha256')
    for (const row of rows) hash.update(JSON.stringify([row.seq, row.event]))
    return hash.digest('hex')
  }

  private goalSeq(id: string): number {
    return (
      this.db
        .prepare(
          "SELECT COALESCE(MAX(seq), 0) AS seq FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'goal'",
        )
        .get(id) as { seq: number }
    ).seq
  }

  private completionState(id: string): string {
    return JSON.stringify([
      this.goalSeq(id),
      this.inputState(id),
      this.host.revisions.get(id) ?? 0,
      this.host.get(id).cwd,
    ])
  }

  private completionPending(id: string): boolean {
    return this.host.hasBlockingQuestions(id) || this.host.hasRunningTasks(id) || !!this.host.queued(id).length
  }

  async updateGoal(
    id: string,
    status: 'active' | 'completed' | 'blocked',
    reason: string,
    evidence?: GoalEvidence,
  ): Promise<ChatGoal> {
    const goal = this.getGoal(id)
    if (!goal || !['active', 'blocked'].includes(goal.status))
      throw new Error('No active goal. Only the user can resume a paused goal.')
    if (!reason.trim() || reason.length > 8000)
      throw new Error('Include unfinished work, completion evidence, or the blocker.')
    if (status !== 'completed') {
      this.verifying.get(id)?.abort()
      return this.saveGoal(id, { ...goal, status, reason: reason.trim(), claim: undefined, updatedAt: Date.now() })!
    }
    if (this.completionPending(id))
      throw new Error('Wait for required input, queued instructions and running helpers before declaring completion.')
    const state = this.completionState(id)
    const session = this.host.get(id)
    const snapshot = await this.host.goalProbes().snapshot(session.cwd)
    const baseline = snapshot ? this.baseline(goal.id) : null
    const problem = evidenceProblem(evidence)
    if (problem) throw new Error(problem)
    const unlisted = unlistedChanges(
      evidence!,
      snapshot && baseline ? { snapshot, changed: changedSince(baseline, snapshot), cwd: session.cwd } : null,
    )
    if (unlisted.length) evidence = { ...evidence!, unlisted }
    const current = this.getGoal(id)
    if (
      !current ||
      this.host.shutdown() ||
      this.completionState(id) !== state ||
      this.completionPending(id) ||
      !['active', 'blocked'].includes(current.status)
    )
      throw new Error('The goal changed while its evidence was checked. Review it and report again.')
    this.verifying.get(id)?.abort()
    const text = reason.trim()
    // With a verification command, completion waits until the agent's turn is over and the command has passed.
    if (current.verify)
      return this.saveGoal(id, {
        ...current,
        status: 'active',
        reason: `Completion reported; waiting for \`${current.verify}\` to pass.`,
        claim: { reason: text, evidence: evidence!, at: Date.now(), inputState: this.inputState(id) },
        updatedAt: Date.now(),
      })!
    return this.saveGoal(id, {
      ...current,
      status: 'completed',
      reason: text,
      evidence,
      claim: undefined,
      updatedAt: Date.now(),
    })!
  }

  controlGoal(id: string, action: 'pause' | 'resume' | 'clear'): ChatGoal | null {
    const goal = this.getGoal(id)
    if (action === 'clear') return this.saveGoal(id, null)
    if (!goal) throw new Error('This thread has no goal.')
    if (action === 'pause') this.verifying.get(id)?.abort()
    if (action === 'resume' && goal.status === 'completed')
      throw new Error('This goal is already complete. Start a new goal.')
    if (action === 'resume') this.host.updateQueue(id, this.host.queued(id), false)
    return this.saveGoal(id, {
      ...goal,
      status: action === 'pause' ? 'paused' : 'active',
      // The user's pause replaces a limit hold, and a resume clears either: only the user's pause never resumes by itself.
      pausedBy: action === 'pause' ? 'user' : undefined,
      turns: action === 'resume' && goal.status === 'turn-limit' ? 0 : goal.turns,
      retryAt: undefined,
      retryDelay: undefined,
      // A resume, or a user message that unblocks a goal, starts stall counting and any pending claim over.
      ...(action === 'resume' ? { stall: undefined, claim: undefined } : {}),
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
      const cap = goal ? goalTurnLimit(goal, this.goalPreferences()) : null
      if (goal?.status === 'turn-limit' && (cap === null || goal.turns < cap)) {
        this.saveGoal(id, { ...goal, status: 'active', reason: 'Continuation limit increased.', updatedAt: Date.now() })
        continue
      }
      if (goal && goalContinues(goal)) this.scheduleGoal(id)
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
    if (this.host.shutdown() || this.host.providerWait(id) || !goal || !goalContinues(goal)) return
    // Reopening a done thread does not resume its goal by itself; the person resumes it.
    if (this.host.threadDone(id)) return
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
      this.host.workspaceBusy(session.covers)
    ) {
      this.scheduleGoal(id, 1000)
      return
    }
    // A completion claim is settled before any further turn is spent: run the command, then complete or go on.
    if (goal.claim && goal.status === 'active') {
      await this.verifyClaim(id, goal, session.cwd)
      return
    }
    const cap = goalTurnLimit(goal, this.goalPreferences())
    if (!isLimitHold(goal) && cap !== null && goal.turns >= cap) {
      this.saveGoal(id, {
        ...goal,
        status: 'turn-limit',
        reason: `Reached ${cap} automatic continuation turns. Resume to allow another batch, or raise this goal's limit.`,
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
    if (isLimitHold(goal) && session.settings.autoFallback && !freshAvailability && readings.length) {
      const order = this.host.policyOf(await this.host.catalog(), this.host.preferences()).order
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
    if (isLimitHold(goal) && !freshAvailability && (goal.retryAt ?? 0) > Date.now()) {
      this.scheduleGoal(id, Math.min(60_000, goal.retryAt! - Date.now()))
      return
    }
    // Another timer may have started a dispatch while this one awaited the catalog.
    if (this.goalDispatching.has(id) || this.host.shutdown()) return
    this.goalDispatching.add(id)
    const revision = this.host.revisions.get(id) ?? 0
    try {
      await this.host.finalizing.get(id)
      goal = this.getGoal(id)
      if (
        this.host.shutdown() ||
        !goal ||
        !goalContinues(goal) ||
        revision !== (this.host.revisions.get(id) ?? 0) ||
        this.host.queued(id).length ||
        this.host.queuePaused(id) ||
        this.host.workspaceBusy(session.covers)
      ) {
        this.scheduleGoal(id)
        return
      }
      const retry = isLimitHold(goal)
      // A retry after a usage limit repeats the turn that was cut off, so it is not a continuation and never a stall.
      let stall = goal.stall
      if (!retry) {
        const goalRevision = this.goalSeq(id)
        const assessed = await this.assessStall(id, goal, session.cwd)
        const latest = this.getGoal(id)
        if (
          !latest ||
          this.goalSeq(id) !== goalRevision ||
          latest.status !== 'active' ||
          revision !== (this.host.revisions.get(id) ?? 0)
        ) {
          this.scheduleGoal(id)
          return
        }
        if (assessed.stalled) {
          this.saveGoal(id, {
            ...latest,
            status: 'blocked',
            reason: `${STALL_REASON}: the last ${STALL_LIMIT} continuations changed no files and repeated the same tool calls with the same results. Give new instructions or resume to try again.`,
            stall: assessed.stall,
            updatedAt: Date.now(),
          })
          return
        }
        stall = assessed.stall
        goal = latest
      }
      const next: ChatGoal = {
        ...goal,
        status: 'active' as const,
        pausedBy: undefined,
        turns: goal.turns + (retry ? 0 : 1),
        retryAt: undefined,
        stall,
        // The failed verification output travels once, with the continuation built from the goal as it is now.
        ...(goal.check && !goal.check.ok && !goal.check.delivered ? { check: { ...goal.check, delivered: true } } : {}),
        updatedAt: Date.now(),
      }
      this.saveGoal(id, next)
      await this.host.send(id, goalContinuation(next, goal.check), [], undefined, false, { revision, goalId: goal.id })
    } finally {
      this.goalDispatching.delete(id)
    }
  }

  /** Runs the user's verification command for a pending completion claim, then completes the goal or hands the failure back. */
  private async verifyClaim(id: string, goal: ChatGoal, cwd: string): Promise<void> {
    const claim = goal.claim!
    const state = this.completionState(id)
    // Instructions received after a durable claim require fresh evidence, including after restart.
    if (claim.inputState !== this.inputState(id)) {
      this.saveGoal(id, {
        ...goal,
        claim: undefined,
        reason: 'Instructions changed after completion was reported. Review them and report again.',
        updatedAt: Date.now(),
      })
      return
    }
    const stillCurrent = () => this.completionState(id) === state && !this.completionPending(id)
    if (!goal.verify) {
      // The command was removed while the claim waited: the evidence checks already passed.
      this.saveGoal(id, {
        ...goal,
        status: 'completed',
        reason: claim.reason,
        evidence: claim.evidence,
        claim: undefined,
        updatedAt: Date.now(),
      })
      return
    }
    const controller = new AbortController()
    this.goalDispatching.add(id)
    this.verifying.set(id, controller)
    try {
      await this.host.finalizing.get(id)
      if (!stillCurrent() || controller.signal.aborted || this.host.shutdown()) return
      const result = await this.host.goalProbes().verify(cwd, goal.verify, controller.signal)
      if (controller.signal.aborted || this.host.shutdown()) return
      const current = this.getGoal(id)
      if (!current || !stillCurrent() || current.status !== 'active' || !current.claim) return
      const how = result.timedOut
        ? 'timed out'
        : result.code === null
          ? 'could not run'
          : `exited with code ${result.code}`
      const check = {
        command: goal.verify,
        ok: result.ok,
        code: result.code,
        ...(result.timedOut ? { timedOut: true } : {}),
        output: clipTail(redactSecrets(`${result.ok ? '' : `Command ${how}.\n`}${result.output}`.trim()), CHECK_OUTPUT),
        at: Date.now(),
      }
      if (result.ok)
        this.saveGoal(id, {
          ...current,
          status: 'completed',
          reason: `${claim.reason}\n\nVerified: \`${goal.verify}\` passed.`,
          evidence: claim.evidence,
          claim: undefined,
          check,
          updatedAt: Date.now(),
        })
      else
        this.saveGoal(id, {
          ...current,
          claim: undefined,
          check,
          reason: `Verification failed: \`${goal.verify}\` ${how}. Its output goes to the agent with the next continuation.`,
          updatedAt: Date.now(),
        })
    } finally {
      if (this.verifying.get(id) === controller) this.verifying.delete(id)
      this.goalDispatching.delete(id)
      if (!this.host.shutdown() && this.getGoal(id)?.status === 'active') this.scheduleGoal(id)
    }
  }

  /**
   * Compares what the turn since the last continuation left behind (files changed since the goal began, tool calls and their
   * results) with the continuation before it. Two in a row that match mean the agent is going round in circles.
   */
  private async assessStall(
    id: string,
    goal: ChatGoal,
    cwd: string,
  ): Promise<{ stalled: boolean; stall: NonNullable<ChatGoal['stall']> }> {
    const snapshot: WorkspaceSnapshot | null = await this.host.goalProbes().snapshot(cwd)
    const baseline = snapshot ? this.baseline(goal.id) : null
    const changed = snapshot ? (baseline ? changedSince(baseline, snapshot) : snapshot.files) : null
    const previous = goal.stall
    const rows = this.db
      .prepare(
        "SELECT seq, event FROM agent_events WHERE session_id = ? AND seq > ? AND json_extract(event, '$.kind') IN ('tool-use', 'tool-result', 'user') ORDER BY seq",
      )
      .all(id, previous?.seq ?? 0) as { seq: number; event: string }[]
    const last =
      (
        this.db.prepare('SELECT MAX(seq) AS seq FROM agent_events WHERE session_id = ?').get(id) as {
          seq: number | null
        }
      ).seq ?? 0
    const activity = turnActivity(rows.map((row) => JSON.parse(row.event) as AgentEvent))
    const fingerprint = fingerprintOf(changed, activity.tools)
    // The first continuation has nothing before it to match, and a user message changes the task.
    const unchanged = !previous || activity.user || previous.fingerprint !== fingerprint ? 0 : previous.unchanged + 1
    return { stalled: unchanged >= STALL_LIMIT, stall: { fingerprint, unchanged, seq: last } }
  }

  /** Drops every pending continuation timer, as on shutdown. */
  clearGoalTimers(): void {
    for (const controller of this.verifying.values()) controller.abort()
    for (const timer of this.goalTimers.values()) clearTimeout(timer)
    this.goalTimers.clear()
  }
}
