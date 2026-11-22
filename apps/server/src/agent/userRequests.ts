import type { ForwardedRequest } from './childRequests'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { matchesCommand, PermissionApprovals } from './permissionApprovals'
import type { AgentEvent, AgentSessionInfo, PermissionScope, AppPreferences } from '@ramu/shared/types'
import {
  answerMessage,
  questionKey,
  questionAnswer,
  questionState,
  requestOutcomes,
  type QuestionInput,
  type QuestionRequest,
  type QuestionState,
} from '@ramu/shared/chat/questions'
import type { PendingRequest } from './types'
import { WRITING_STATES } from './constants'
import type { MessageDispatcher } from './messageDispatcher'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { SessionStore } from './sessionStore'
import type { AgentService } from '../agent'
import type { Db } from '../db'
import type { SecretFiles } from './secretFiles'

export interface SecretRequestInput {
  label: string
  reason: string
  placeholder?: string
  envName?: string
  url?: string
  timeoutMs: number
}
export type SecretRequestResult =
  { status: 'saved'; file: string; savedAs?: string } | { status: 'declined' | 'cancelled' | 'timed_out' }

type SecretEvent = Extract<AgentEvent, { kind: 'secret-request' }>

/** What UserRequests needs from the rest of the service. */
export interface UserRequestsHost
  extends
    Pick<MessageDispatcher, 'canSteer' | 'dispatchSteering' | 'updateQueue' | 'wakeWorkspaceQueue' | 'workspaceQueue'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<SessionRegistry, 'live' | 'runners'>,
    Pick<SessionStore, 'events' | 'get' | 'queued'> {
  preferences(): AppPreferences | undefined
  launchSettings(id: string): { asyncQuestions: boolean }
  shutdown(): AgentService['shutdown']
}

/** What Ramu's own approval card offers beside Allow once. */
export interface PermissionOptions {
  /** Always allow: runs this instead of saving an approval rule, such as switching an MCP tool to Allow. */
  always?: () => void
  /** A production deploy: the card offers Allow production deploys in this thread, and nothing lasting. */
  productionDeploy?: boolean
}

/** The line a production deploy's card adds to say what happens when it is allowed. */
export const PRODUCTION_DEPLOY_NOTE = "This deploys to production; the project's migrations run first."

/** Requests that wait for the user: questions, permission prompts and elicitations, including those a sub-agent raises in its parent's chat. */
export class UserRequests {
  constructor(
    private readonly host: UserRequestsHost,
    private readonly db: Db,
  ) {}

  private questionWaiters = new Map<string, Set<(cancel?: boolean) => void>>()
  private secretWaiters = new Map<
    string,
    { sessionId: string; request: SecretEvent; finish: (result: SecretRequestResult) => boolean }
  >()
  /** Where answered secrets go; set by the server, absent in tests that never answer one. */
  secretFiles: SecretFiles | undefined
  private appPermissions = new Map<
    string,
    { sessionId: string; finish: (allow: boolean, cancelled?: boolean) => void; options: PermissionOptions }
  >()
  /** Threads that allowed production deploys for themselves; kept in memory, so a restart asks again. */
  private productionAllowed = new Set<string>()
  /** Provider requests whose migrations are running, so a second click does not run them twice. */
  private migrating = new Set<string>()
  /**
   * Runs the thread's project's migrations against production before a deploy goes out, and says what it did; throws
   * when they fail. Set by the server; a host without it deploys nothing to production.
   */
  beforeProduction: (session: AgentSessionInfo) => Promise<string> = async () => {
    throw new Error('This host cannot run the migrations a production deploy needs first.')
  }

  /** App-owned capabilities use the same durable approval UI for every provider, without borrowing its runner. */
  requestPermission(
    id: string,
    toolName: string,
    detail: string,
    signal?: AbortSignal,
    options: PermissionOptions = {},
  ): Promise<boolean> {
    if (signal?.aborted || this.host.shutdown() || !['starting', 'running'].includes(this.host.get(id).state))
      return Promise.reject(new Error('This permission request is no longer active.'))
    if (options.productionDeploy && this.productionAllowed.has(id)) return Promise.resolve(true)
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const abort = () => finish(false, true)
      const finish = (allow: boolean, cancelled = false) => {
        if (!this.appPermissions.delete(requestId)) return
        signal?.removeEventListener('abort', abort)
        this.host.record(id, {
          kind: 'request-resolved',
          requestId,
          outcome: cancelled ? 'cancelled' : allow ? 'allowed' : 'denied',
        })
        if (
          this.host.get(id).state === 'needs-input' &&
          ![...this.appPermissions.values()].some((entry) => entry.sessionId === id) &&
          !this.hasBlockingQuestions(id) &&
          !this.host.live.get(id)?.pending.size
        )
          this.host.setState(id, 'running')
        if (cancelled) reject(new Error('Permission request was cancelled.'))
        else resolve(allow)
      }
      this.appPermissions.set(requestId, { sessionId: id, finish, options })
      this.host.record(id, {
        kind: 'permission-request',
        requestId,
        toolName,
        title: `Allow ${toolName}?`,
        detail,
        approvalOnceOnly: true,
        ...(options.always ? { approvalAlways: toolName } : {}),
        ...(options.productionDeploy ? { productionDeploy: true as const } : {}),
      })
      this.host.setState(id, 'needs-input')
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }

  /**
   * A production deploy Ramu itself performs (an MCP tool, a plugin's CLI): asks unless the thread allowed production
   * deploys, then runs the migrations. Resolves with what the migrations did, or null when refused; throws when the
   * migrations fail, and then nothing may be deployed.
   */
  async approveProductionDeploy(
    id: string,
    toolName: string,
    detail: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const allowed = await this.requestPermission(id, toolName, `${detail}\n${PRODUCTION_DEPLOY_NOTE}`, signal, {
      productionDeploy: true,
    })
    return allowed ? this.migrateFirst(id) : null
  }

  private async migrateFirst(id: string): Promise<string> {
    try {
      return await this.beforeProduction(this.host.get(id))
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nNothing was deployed. Fix the cause, then deploy again.`,
        { cause: error },
      )
    }
  }

  /** Shows a secret card in the thread and waits for the person, the timeout, or the run to end. */
  requestSecret(id: string, input: SecretRequestInput, signal?: AbortSignal): Promise<SecretRequestResult> {
    if (signal?.aborted || this.host.shutdown() || !WRITING_STATES.includes(this.host.get(id).state))
      return Promise.reject(new Error('This thread is no longer working.'))
    const request: SecretEvent = {
      kind: 'secret-request',
      requestId: randomUUID(),
      label: input.label,
      reason: input.reason,
      ...(input.placeholder ? { placeholder: input.placeholder } : {}),
      ...(input.envName ? { envName: input.envName } : {}),
      ...(input.url ? { url: input.url } : {}),
    }
    return new Promise((resolve) => {
      const abort = () => finish({ status: 'cancelled' })
      const timer = setTimeout(() => finish({ status: 'timed_out' }), input.timeoutMs)
      const finish = (result: SecretRequestResult) => {
        if (!this.secretWaiters.delete(request.requestId)) return false
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.host.record(id, {
          kind: 'request-resolved',
          requestId: request.requestId,
          outcome: result.status === 'saved' && result.savedAs ? 'saved-env' : result.status,
        })
        if (this.host.get(id).state === 'needs-input' && !this.hasBlockingQuestions(id))
          this.host.setState(id, 'running')
        resolve(result)
        return true
      }
      this.secretWaiters.set(request.requestId, { sessionId: id, request, finish })
      this.host.record(id, request)
      this.host.setState(id, 'needs-input')
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }

  /** The secret card this thread still waits on; anything else is refused before a value is stored. */
  pendingSecret(id: string, requestId: string): SecretEvent {
    const waiter = this.secretWaiters.get(requestId)
    if (!waiter || waiter.sessionId !== id) throw new Error('This secret request is no longer active.')
    return waiter.request
  }

  /** Stores the value in an owner-only file and hands the agent its path; null declines. */
  async answerSecret(
    id: string,
    requestId: string,
    answer: { secret: string; savedAs?: string } | null,
  ): Promise<void> {
    const waiter = this.secretWaiters.get(requestId)
    this.pendingSecret(id, requestId)
    if (!answer) {
      waiter!.finish({ status: 'declined' })
      return
    }
    const secret = answer.secret.trim()
    if (!secret) throw new Error('Enter the secret, or decline.')
    if (!this.secretFiles) throw new Error('This host cannot store secrets.')
    const file = await this.secretFiles.write(secret)
    // The run may have ended while the file was written; nobody would receive its path.
    if (!waiter!.finish({ status: 'saved', file, ...(answer.savedAs ? { savedAs: answer.savedAs } : {}) })) {
      await rm(file, { force: true })
      throw new Error('This secret request is no longer active.')
    }
  }

  /** A child's pending approval or question, by request id: the parent's chat shows it and replies go to the child. */
  readonly childRequests = new Map<string, ForwardedRequest>()

  private forwarded(id: string, requestId: string): ForwardedRequest | undefined {
    const known = this.childRequests.get(requestId)
    if (known?.parentId === id) return known
    // Reconstruct forwarding after reconnect/restart using the durable server-authored origin.
    const event = this.host
      .events(id)
      .findLast(
        (e) =>
          (e.kind === 'permission-request' || e.kind === 'question' || e.kind === 'elicitation') &&
          e.requestId === requestId,
      )
    if (known && !event) throw new Error('This request does not belong to this thread.')
    const source = event?.requestSource
    if (!source || source.sessionId === id) return undefined
    const forwarded = { parentId: id, childId: source.sessionId, requestId: source.requestId ?? requestId }
    if (forwarded.requestId !== requestId) this.childRequests.set(requestId, forwarded)
    return forwarded
  }

  questionStatus(id: string, requestId: string): QuestionState & { request: QuestionRequest } {
    const events = this.host.events(id)
    const request = events.find((e): e is QuestionRequest => e.kind === 'question' && e.requestId === requestId)
    if (!request) throw new Error('This question does not belong to this thread.')
    return { request, ...questionState(events, requestId) }
  }

  async askQuestion(
    id: string,
    input: QuestionInput,
    signal?: AbortSignal,
  ): Promise<QuestionState & { request: QuestionRequest }> {
    if (signal?.aborted) throw new Error('Question request was cancelled.')
    if (this.host.shutdown() || !WRITING_STATES.includes(this.host.get(id).state))
      throw new Error('This thread is no longer working.')
    const questions = input.questions.map((q, i) => ({ ...q, id: q.id ?? String(i) }))
    if (!questions.length || new Set(questions.map(questionKey)).size !== questions.length)
      throw new Error('Questions need unique IDs.')
    const requestId = randomUUID()
    const blocking = input.blocking || !this.host.launchSettings(id).asyncQuestions
    this.host.record(id, {
      kind: 'question',
      requestId,
      questions,
      responseMode: blocking ? 'ramu' : 'message',
      grouping: input.grouping ?? 'together',
      dependsOn: input.dependsOn,
    })
    return blocking ? this.waitForAnswer(id, requestId, signal) : this.questionStatus(id, requestId)
  }

  async waitForAnswer(
    id: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<QuestionState & { request: QuestionRequest }> {
    const initial = this.questionStatus(id, requestId)
    if (initial.outcome) return initial
    if (signal?.aborted) throw new Error('Question wait was cancelled.')
    this.host.record(id, { kind: 'question-state', requestId, waiting: true })
    this.host.setState(id, 'needs-input')
    return new Promise((resolve, reject) => {
      const key = `${id}:${requestId}`
      const callbacks = this.questionWaiters.get(key) ?? new Set<(cancel?: boolean) => void>()
      const finish = (aborted = false) => {
        const state = this.questionStatus(id, requestId)
        if (!aborted && !state.outcome) return
        callbacks.delete(check)
        signal?.removeEventListener('abort', cancel)
        if (aborted && state.request.responseMode === 'ramu' && !state.outcome)
          this.host.record(id, { kind: 'request-resolved', requestId, outcome: 'cancelled' })
        if (!callbacks.size) {
          this.questionWaiters.delete(key)
          this.host.record(id, { kind: 'question-state', requestId, waiting: false })
          if (this.host.get(id).state === 'needs-input' && !this.hasBlockingQuestions(id))
            this.host.setState(id, 'running')
        }
        if (aborted) reject(new Error('Question wait was cancelled.'))
        else resolve(state)
      }
      const check = (aborted = false) => finish(aborted)
      const cancel = () => finish(true)
      callbacks.add(check)
      this.questionWaiters.set(key, callbacks)
      signal?.addEventListener('abort', cancel, { once: true })
      check()
    })
  }

  hasBlockingQuestions(id: string): boolean {
    const events = this.host.events(id)
    const outcomes = requestOutcomes(events)
    return events.some((e) => {
      if (e.kind === 'secret-request') return !outcomes.has(e.requestId)
      if (e.kind !== 'question' && e.kind !== 'permission-request' && e.kind !== 'elicitation') return false
      if (e.kind === 'permission-request') return !outcomes.has(e.requestId)
      const state = questionState(events, e.requestId)
      return !state.outcome && (e.kind === 'elicitation' || e.responseMode !== 'message' || state.waiting)
    })
  }

  saveQuestionDraft(id: string, requestId: string, drafts: Record<string, string>): void {
    const child = this.forwarded(id, requestId)
    if (child && child.childId !== id) return this.saveQuestionDraft(child.childId, child.requestId, drafts)
    const state = this.questionStatus(id, requestId)
    if (state.outcome) return
    const keys = new Set(state.request.questions.map(questionKey))
    this.host.record(id, {
      kind: 'question-state',
      requestId,
      drafts: Object.fromEntries(Object.entries(drafts).filter(([key]) => keys.has(key) && !state.answers[key])),
    })
  }

  closeQuestion(id: string, requestId: string, outcome: 'dismissed' | 'obsolete', reason?: string): void {
    const child = this.forwarded(id, requestId)
    if (child && child.childId !== id) return this.closeQuestion(child.childId, child.requestId, outcome, reason)
    const state = this.questionStatus(id, requestId)
    if (state.outcome) throw new Error('This question is already closed.')
    if (state.request.responseMode !== 'message')
      throw new Error('This question needs an answer. Answer it or stop the thread.')
    if (outcome === 'obsolete' && !reason?.trim()) throw new Error('Explain why this question is no longer needed.')
    this.host.record(id, { kind: 'question-state', requestId, reason })
    this.host.record(id, { kind: 'request-resolved', requestId, outcome })
  }

  private permissionRequest(id: string, requestId: string) {
    const event = this.host
      .events(id)
      .findLast((event) => event.kind === 'permission-request' && event.requestId === requestId)
    if (!event || event.kind !== 'permission-request')
      throw new Error('This permission request does not belong to this thread.')
    return event
  }

  applySavedPermission(id: string, request: Extract<AgentEvent, { kind: 'permission-request' }>): void {
    if (
      (request.approvalSessionId && request.approvalSessionId !== id) ||
      this.host.shutdown() ||
      (!request.approvalKey && !request.productionDeploy) ||
      requestOutcomes(this.host.events(id)).get(request.requestId)
    )
      return
    const session = this.host.get(id)
    if (!['running', 'starting', 'needs-input'].includes(session.state)) return
    if (request.productionDeploy) {
      if (this.productionAllowed.has(id))
        try {
          this.replyPermission(id, request.requestId, true)
        } catch {
          /* A provider may withdraw the request before this microtask. */
        }
      return
    }
    if (!request.approvalKey) return
    const approvals = new PermissionApprovals(this.db)
    const rule = approvals.find(
      request.approvalProvider ?? session.provider,
      request.approvalKey,
      approvals.project(session.taskId),
      request.approvalCommand,
      session.settings.access,
    )
    if (rule && rule.behavior !== 'ask') {
      try {
        if (rule.builtin) {
          this.replyPermission(id, request.requestId, true)
          this.host.record(id, {
            kind: 'request-resolved',
            requestId: request.requestId,
            outcome: 'allowed-auto',
          })
        } else this.replyPermission(id, request.requestId, true, undefined, rule.scope, rule.pattern)
      } catch {
        /* A provider may withdraw the request before this microtask. */
      }
    }
  }

  replyPermission(
    id: string,
    requestId: string,
    allow: boolean,
    message?: string,
    scope: PermissionScope = 'once',
    pattern?: string,
  ): void {
    const child = this.forwarded(id, requestId)
    if (child && child.childId !== id)
      return this.replyPermission(child.childId, child.requestId, allow, message, scope, pattern)
    const request = this.permissionRequest(id, requestId)
    if (request.approvalSessionId && request.approvalSessionId !== id)
      return this.replyPermission(request.approvalSessionId, requestId, allow, message, scope, pattern)
    if (requestOutcomes(this.host.events(id)).get(requestId))
      throw new Error('This permission request is already closed.')
    if (
      scope !== 'once' &&
      (!allow ||
        (scope === 'thread'
          ? !request.productionDeploy
          : request.productionDeploy || (!request.approvalKey && !(scope === 'user' && request.approvalAlways))))
    )
      throw new Error('This request can only be approved once.')
    if (pattern && (scope === 'once' || !matchesCommand(pattern, request.approvalCommand)))
      throw new Error('Choose an offered command pattern.')
    const appPermission = this.appPermissions.get(requestId)
    if (appPermission) {
      if (appPermission.sessionId !== id) throw new Error('This approval belongs to another thread.')
      if (allow && scope === 'thread') this.productionAllowed.add(id)
      else if (allow && scope === 'user') appPermission.options.always?.()
      appPermission.finish(allow)
      return
    }
    if (request.productionDeploy && allow) {
      if (scope === 'thread') this.productionAllowed.add(id)
      this.deployAfterMigrations(id, requestId)
      return
    }
    const session = this.host.get(id)
    const approvals = new PermissionApprovals(this.db)
    const project = approvals.project(session.taskId)
    if (scope === 'project' && !project) throw new Error('This thread has no project.')
    this.answerProvider(id, requestId, allow, message)
    if (allow && (scope === 'project' || scope === 'user')) {
      const savedApprovalId = approvals.remember(
        request.approvalProvider ?? session.provider,
        request.approvalKey!,
        scope,
        project,
        { label: pattern ?? `${request.toolName}: ${request.detail.slice(0, 300)}`, pattern },
      )
      this.host.record(id, { kind: 'request-resolved', requestId, outcome: `allowed-${scope}`, savedApprovalId })
    }
  }

  /** Answers the provider's own request: its runner, or Claude's waiting permission callback. */
  private answerProvider(id: string, requestId: string, allow: boolean, message?: string): void {
    const runner = this.host.runners.get(id)
    if (runner) return runner.replyPermission(requestId, allow)
    const pending = this.takePending(id, requestId, 'permission')
    pending.resolve(
      allow
        ? { behavior: 'allow', updatedInput: pending.input }
        : { behavior: 'deny', message: message || 'Denied by the user' },
    )
    this.host.record(id, { kind: 'request-resolved', requestId, outcome: allow ? 'allowed' : 'denied' })
    this.afterRequest(id)
  }

  /**
   * Lets an allowed production deploy go once the project's migrations ran against production. A failure refuses the
   * command instead, so nothing is deployed, and the thread shows why.
   */
  private deployAfterMigrations(id: string, requestId: string): void {
    if (this.migrating.has(requestId))
      throw new Error('The migrations are running; the deploy goes out when they finish.')
    this.migrating.add(requestId)
    void (async () => {
      const failure = await this.migrateFirst(id).then(
        () => null,
        (error: Error) => error.message,
      )
      if (failure) this.host.record(id, { kind: 'error', message: failure })
      this.answerProvider(id, requestId, !failure, failure ?? undefined)
    })()
      // The request may have ended with the run while the migrations ran; there is nobody left to answer.
      .catch(() => {})
      .finally(() => this.migrating.delete(requestId))
  }

  forgetPermission(id: string, requestId: string, scope: 'project' | 'user'): void {
    const child = this.forwarded(id, requestId)
    if (child && child.childId !== id) return this.forgetPermission(child.childId, child.requestId, scope)
    const request = this.permissionRequest(id, requestId)
    if (request.approvalSessionId && request.approvalSessionId !== id)
      return this.forgetPermission(request.approvalSessionId, requestId, scope)
    const outcome = requestOutcomes(this.host.events(id)).get(requestId)
    if (!request.approvalKey || outcome !== `allowed-${scope}`)
      throw new Error('This request has no saved approval in that scope.')
    const session = this.host.get(id)
    const approvals = new PermissionApprovals(this.db)
    const resolution = this.host
      .events(id)
      .findLast((event) => event.kind === 'request-resolved' && event.requestId === requestId)
    if (resolution?.kind === 'request-resolved' && resolution.savedApprovalId)
      approvals.remove(resolution.savedApprovalId)
    else
      approvals.forget(
        request.approvalProvider ?? session.provider,
        request.approvalKey,
        scope,
        approvals.project(session.taskId),
      )
    this.host.record(id, { kind: 'request-resolved', requestId, outcome: `allowed-${scope}-forgotten` })
  }

  private pendingElicitation(id: string, requestId: string) {
    const events = this.host.events(id)
    const request = events.find((event) => event.kind === 'elicitation' && event.requestId === requestId)
    if (!request || request.kind !== 'elicitation')
      throw new Error('This input request does not belong to this thread.')
    if (questionState(events, requestId).outcome) throw new Error('This input request is already closed.')
    return request
  }

  saveElicitationDraft(id: string, requestId: string, drafts: Record<string, string>): void {
    const child = this.forwarded(id, requestId)
    if (child && child.childId !== id) return this.saveElicitationDraft(child.childId, child.requestId, drafts)
    const request = this.pendingElicitation(id, requestId)
    const fields = new Set(request.fields.map((field) => field.id))
    this.host.record(id, {
      kind: 'question-state',
      requestId,
      drafts: Object.fromEntries(Object.entries(drafts).filter(([key]) => fields.has(key))),
    })
  }

  replyElicitation(
    id: string,
    requestId: string,
    action: import('@ramu/shared/types').ElicitationAction,
    answers: Record<string, string>,
  ): void {
    const child = this.forwarded(id, requestId)
    if (child && child.childId !== id) return this.replyElicitation(child.childId, child.requestId, action, answers)
    this.pendingElicitation(id, requestId)
    const runner = this.host.runners.get(id)
    if (!runner?.replyElicitation) throw new Error('That input request is no longer pending.')
    runner.replyElicitation(requestId, action, answers)
    if (action === 'accept') this.host.record(id, { kind: 'question-state', requestId, answers })
  }

  replyQuestion(id: string, requestId: string, answers: Record<string, string>): void {
    const child = this.forwarded(id, requestId)
    if (child && child.childId !== id) return this.replyQuestion(child.childId, child.requestId, answers)
    const status = this.questionStatus(id, requestId)
    if (status.outcome) throw new Error('This question is already closed.')
    if (status.request.responseMode) {
      const available = status.request.questions.filter((q) => !status.answers[questionKey(q)])
      const valid = new Set(available.map(questionKey))
      const submitted: Record<string, string> = Object.assign(
        Object.create(null),
        Object.fromEntries(Object.entries(answers).map(([key, text]) => [key, text.trim()])),
      )
      if (!Object.keys(submitted).length || Object.entries(submitted).some(([key, text]) => !valid.has(key) || !text))
        throw new Error('Answer an unanswered question before sending.')
      if (status.request.grouping !== 'independent' && available.some((q) => !submitted[questionKey(q)]))
        throw new Error('These questions are related. Send all their answers together.')
      const combined: Record<string, string> = Object.assign(Object.create(null), status.answers, submitted)
      const done = status.request.questions.every((q) => combined[questionKey(q)])
      const working = WRITING_STATES.includes(this.host.get(id).state)
      const waiting = working && !!this.questionWaiters.get(`${id}:${requestId}`)?.size
      // A finished turn can leave a tool waiter behind; resolving it cannot resume the agent.
      const deliverMessage = !waiting && (status.request.responseMode === 'message' || !working)
      // Persist delivery before closing the question. Unsent answers use the normal durable queue.
      this.db.exec('SAVEPOINT question_answer')
      try {
        if (deliverMessage) {
          const text = answerMessage(
            requestId,
            available
              .filter((q) => submitted[questionKey(q)])
              .map((q) => ({ question: q.question, answer: submitted[questionKey(q)]! })),
          )
          this.host.updateQueue(
            id,
            [
              ...this.host.queued(id),
              { id: randomUUID(), text, mode: this.host.canSteer(this.host.get(id)) ? 'steer' : 'queue' },
            ],
            false,
          )
        }
        this.host.record(id, { kind: 'question-state', requestId, answers: submitted })
        if (done) this.host.record(id, { kind: 'request-resolved', requestId, outcome: 'answered' })
        this.db.exec('RELEASE question_answer')
      } catch (error) {
        this.db.exec('ROLLBACK TO question_answer; RELEASE question_answer')
        throw error
      }
      if (deliverMessage) {
        this.host.workspaceQueue.add(id)
        queueMicrotask(() => {
          void this.host.dispatchSteering(id)
          this.host.wakeWorkspaceQueue()
        })
      }
      return
    }
    const canonical = Object.fromEntries(
      status.request.questions.map((q) => [
        questionKey(q),
        (questionAnswer(answers, questionKey(q)) ?? questionAnswer(answers, q.question) ?? '').trim(),
      ]),
    )
    if (Object.values(canonical).some((value) => !value)) throw new Error('Answer all questions before sending.')
    this.host.record(id, { kind: 'question-state', requestId, answers: canonical })
    if (this.host.runners.has(id)) return this.host.runners.get(id)!.replyQuestion(requestId, answers)
    const p = this.takePending(id, requestId, 'question')
    // AskUserQuestion receives the user's answers through updatedInput.answers, keyed by question text.
    p.resolve({
      behavior: 'allow',
      updatedInput: {
        ...p.input,
        answers: Object.fromEntries(status.request.questions.map((q) => [q.question, canonical[questionKey(q)]])),
      },
    })
    this.host.record(id, { kind: 'request-resolved', requestId, outcome: 'answered' })
    this.afterRequest(id)
  }

  private takePending(id: string, requestId: string, kind: PendingRequest['kind']): PendingRequest {
    const p = this.host.live.get(id)?.pending.get(requestId)
    if (!p || p.kind !== kind) throw new Error('That request is no longer pending')
    this.host.live.get(id)!.pending.delete(requestId)
    return p
  }

  private afterRequest(id: string): void {
    if (this.host.live.get(id)?.pending.size === 0 && !this.hasBlockingQuestions(id)) this.host.setState(id, 'running')
  }

  /** Wakes whoever waits on this request now that it is resolved. */
  notifyWaiters(id: string, requestId: string): void {
    for (const notify of [...(this.questionWaiters.get(`${id}:${requestId}`) ?? [])]) notify()
  }

  /** Cancels every wait on this chat's questions. */
  cancelWaiters(id: string): void {
    for (const permission of [...this.appPermissions.values()])
      if (permission.sessionId === id) permission.finish(false, true)
    for (const secret of [...this.secretWaiters.values()])
      if (secret.sessionId === id) secret.finish({ status: 'cancelled' })
    for (const [key, callbacks] of this.questionWaiters)
      if (key.startsWith(`${id}:`)) for (const cancel of [...callbacks]) cancel(true)
  }
}
