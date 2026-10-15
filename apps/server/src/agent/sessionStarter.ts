import { providerAccountId } from '../providers/providerBinaries'
import { supportsProviderAccounts } from '@ramu/shared/providers/providers'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentScope,
  type AgentSessionInfo,
  type AgentSettings,
  type Attachment,
} from '@ramu/shared/types'
import { stepKey } from '@ramu/shared/providers/routing'
import { goalInstructions } from './goals'
import { WRITING_STATES } from './constants'
import { LEGACY_ACCOUNT_PROVIDERS } from './settings'
import type { MessageDispatcher } from './messageDispatcher'
import type { GoalManager } from './goalManager'
import type { SessionProcess } from './sessionProcess'
import type { ProviderWaits } from './providerWait'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { UserRequests } from './userRequests'
import type { FallbackRouter } from './fallbackRouter'
import type { SessionStore } from './sessionStore'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** What SessionStarter needs from the rest of the service. */
export interface SessionStarterHost
  extends
    Pick<
      MessageDispatcher,
      | 'capturing'
      | 'goalCommand'
      | 'updateQueue'
      | 'wakeWorkspaceQueue'
      | 'workspaceBusy'
      | 'workspaceQueue'
      | 'workspaceReservations'
    >,
    Pick<GoalManager, 'controlGoal' | 'getGoal' | 'goalPreferences'>,
    Pick<SessionProcess, 'fail' | 'launch' | 'refreshProviderTools' | 'responseStyleInstructions'>,
    Pick<ProviderWaits, 'providerWait' | 'scheduleProvider'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<
      SessionRegistry,
      'activeWriter' | 'draining' | 'finalizing' | 'live' | 'revisions' | 'runners' | 'transitioning'
    >,
    Pick<UserRequests, 'hasBlockingQuestions'>,
    Pick<FallbackRouter, 'attempted' | 'attemptedAccounts' | 'noteRoute' | 'route' | 'switchBeforeSend' | 'withStep'>,
    Pick<SessionStore, 'createSession' | 'get' | 'hasRunningTasks' | 'isRecoveryPending' | 'queuePaused' | 'queued'> {
  reviewHooks(): AgentService['reviewHooks']
  shutdown(): AgentService['shutdown']
  toolConnection(): AgentService['toolConnection']
}

/** Starting a chat and sending it follow-ups. */
export class SessionStarter {
  constructor(
    private readonly host: SessionStarterHost,
    private readonly db: Db,
  ) {}

  async startReviewed(
    taskId: string,
    scope: AgentScope,
    prompt: string,
    settings: AgentSettings = DEFAULT_AGENT_SETTINGS,
    attachments: Attachment[] = [],
  ): Promise<AgentSessionInfo> {
    if (this.host.shutdown()) throw new Error('Application is shutting down')
    if (
      supportsProviderAccounts(settings.provider) &&
      settings.accountId === undefined &&
      (LEGACY_ACCOUNT_PROVIDERS.has(settings.provider) || providerAccountId(settings.provider) !== 'default')
    )
      settings = { ...settings, accountId: providerAccountId(settings.provider) }
    // A new chat starts on the highest-ranked model with room.
    const route = await this.host.route(settings, true)
    const requested = settings
    if (route) settings = this.host.withStep(settings, route.step)
    const started = await this.startRouted(taskId, scope, prompt, settings, attachments)
    if (route) this.host.noteRoute(started.id, requested, settings, route.reason)
    return started
  }

  private async startRouted(
    taskId: string,
    scope: AgentScope,
    prompt: string,
    settings: AgentSettings,
    attachments: Attachment[],
  ): Promise<AgentSessionInfo> {
    if (this.host.workspaceBusy(scope.covers)) {
      const session = this.host.createSession(taskId, scope, settings, 'idle')
      this.host.updateQueue(
        session.id,
        [{ id: randomUUID(), text: prompt, mode: 'queue', ...(attachments.length ? { attachments } : {}) }],
        false,
      )
      this.host.workspaceQueue.add(session.id)
      return this.host.get(session.id)
    }
    scope.covers.forEach((cwd) => this.host.capturing.add(cwd))
    try {
      const reviewId = await this.host.reviewHooks()?.begin(taskId, scope)
      try {
        const session = this.start(taskId, scope, prompt, settings, attachments)
        if (reviewId) this.host.reviewHooks()?.bind(reviewId, session.id)
        return session
      } catch (error) {
        if (reviewId) this.host.reviewHooks()?.abandon(reviewId, error)
        throw error
      }
    } finally {
      scope.covers.forEach((cwd) => this.host.capturing.delete(cwd))
      this.host.wakeWorkspaceQueue()
    }
  }

  /** Starts a session at task scope; the caller takes the scope from ready bindings. */
  start(
    taskId: string,
    scope: AgentScope,
    prompt: string,
    settings: AgentSettings = DEFAULT_AGENT_SETTINGS,
    attachments: Attachment[] = [],
  ): AgentSessionInfo {
    if (scope.covers.some((cwd) => this.host.workspaceReservations.has(cwd)))
      throw new Error('Files are being updated. Try again when the workspace operation finishes.')
    if (this.host.shutdown()) throw new Error('Application is shutting down')
    const writer = this.host.activeWriter(scope.covers)
    if (writer) {
      throw new Error(
        `Another agent session is already writing in ${writer.covers.filter((c) => scope.covers.includes(c)).join(', ')}. Stop it, wait for it, or use an isolated task.`,
      )
    }
    const session = this.host.createSession(taskId, scope, settings, 'starting')
    this.host.attempted.set(session.id, new Set([stepKey(settings)]))
    this.host.attemptedAccounts.delete(session.id)
    this.host.launch(session.id, prompt, null, true, attachments)
    return this.host.get(session.id)
  }

  /** Sends a follow-up. A session without a live process is natively resumed by provider session id. */
  async send(
    id: string,
    text: string,
    attachments: Attachment[] = [],
    reviewId?: string,
    recordUser = true,
    internalGoal?: { revision: number; goalId: string },
    providerRetry = false,
  ): Promise<void> {
    if (recordUser && this.host.goalCommand(id, text, attachments, reviewId)) return
    if (this.host.providerWait(id) && recordUser) {
      this.host.updateQueue(
        id,
        [
          ...this.host.queued(id),
          {
            id: randomUUID(),
            text,
            mode: 'queue',
            ...(attachments.length ? { attachments } : {}),
            ...(reviewId ? { reviewId } : {}),
          },
        ],
        false,
      )
      this.host.scheduleProvider(id)
      return
    }
    await this.host.finalizing.get(id)
    if (this.host.transitioning.has(id)) throw new Error('Provider switch in progress. Try again in a moment.')
    let s = this.host.get(id)
    if (s.covers.some((cwd) => this.host.workspaceReservations.has(cwd) || this.host.capturing.has(cwd)))
      throw new Error('Files are being updated. Try again when the workspace operation finishes.')
    if (WRITING_STATES.includes(s.state)) throw new Error('Wait for the current turn to finish, or interrupt it first.')
    const writer = this.host.activeWriter(s.covers, id)
    if (writer && writer.id !== id) throw new Error(`Another agent session is already writing in ${writer.cwd}`)
    // A provider at its limit would only fail this message; continue with the next fallback instead.
    if (await this.host.switchBeforeSend(id)) {
      await this.host.finalizing.get(id)
    }
    await this.host.refreshProviderTools(id)
    s = this.host.get(id)
    this.host.transitioning.add(id)
    try {
      if (reviewId) await this.host.reviewHooks()?.validateFeedback?.(reviewId)
      if (!s.parentId) await this.host.reviewHooks()?.followup(id)
    } finally {
      this.host.transitioning.delete(id)
    }
    if (
      internalGoal &&
      (this.host.shutdown() ||
        internalGoal.revision !== (this.host.revisions.get(id) ?? 0) ||
        this.host.getGoal(id)?.id !== internalGoal.goalId ||
        this.host.getGoal(id)?.status !== 'active' ||
        this.host.queued(id).length ||
        this.host.queuePaused(id) ||
        WRITING_STATES.includes(this.host.get(id).state) ||
        this.host.hasBlockingQuestions(id) ||
        this.host.hasRunningTasks(id))
    )
      return
    if (!recordUser && !this.host.isRecoveryPending(id) && !internalGoal && !providerRetry) return
    if (recordUser) this.db.prepare('DELETE FROM agent_recovery WHERE session_id = ?').run(id)
    if (recordUser && this.host.getGoal(id)?.status === 'blocked') this.host.controlGoal(id, 'resume')
    const instructions =
      !s.parentId && (this.host.toolConnection() || this.host.getGoal(id))
        ? goalInstructions(this.host.goalPreferences(), this.host.getGoal(id))
        : ''
    const style = this.host.responseStyleInstructions(s)
    const styledText = style ? `${text}\n\n${style}` : text
    const actualText = instructions ? `${styledText}\n\n<ramu-goals>\n${instructions}\n</ramu-goals>` : styledText
    this.host.attempted.set(id, new Set([stepKey(s.settings)]))
    this.host.attemptedAccounts.delete(id)
    const codex = this.host.runners.get(id)
    if (codex) {
      if (recordUser) this.host.record(id, { kind: 'user', text, ...(attachments.length ? { attachments } : {}) })
      this.host.setState(id, 'running')
      try {
        await codex.send(actualText, attachments)
      } catch (e) {
        this.host.fail(id, e)
      }
      return
    }
    const live = this.host.live.get(id)
    if (live) {
      if (recordUser) this.host.record(id, { kind: 'user', text, ...(attachments.length ? { attachments } : {}) })
      live.input.push(actualText, attachments)
      this.host.setState(id, 'running')
      return
    }
    await this.host.draining.get(id)
    this.host.launch(id, text, s.providerSessionId, recordUser, attachments)
  }
}
