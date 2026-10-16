import { randomUUID } from 'node:crypto'
import { PermissionApprovals } from './permissionApprovals'
import type { AgentEvent, PermissionScope, AppPreferences } from '@ramu/shared/types'
import {
  answerMessage,
  questionKey,
  questionAnswer,
  questionState,
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

/** What UserRequests needs from the rest of the service. */
export interface UserRequestsHost
  extends
    Pick<MessageDispatcher, 'canSteer' | 'dispatchSteering' | 'updateQueue' | 'wakeWorkspaceQueue' | 'workspaceQueue'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<SessionRegistry, 'live' | 'runners'>,
    Pick<SessionStore, 'events' | 'get' | 'queued'> {
  preferences(): AppPreferences | undefined
  shutdown(): AgentService['shutdown']
}

/** Requests that wait for the user: questions, permission prompts and elicitations, including those a sub-agent raises in its parent's chat. */
export class UserRequests {
  constructor(
    private readonly host: UserRequestsHost,
    private readonly db: Db,
  ) {}

  private questionWaiters = new Map<string, Set<(cancel?: boolean) => void>>()

  /** A child's pending approval or question, by request id: the parent's chat shows it and replies go to the child. */
  readonly childRequests = new Map<string, string>()

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
    const blocking = input.blocking || this.host.preferences()?.asyncQuestions === false
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
    return events.some((e) => {
      if (e.kind !== 'question' && e.kind !== 'permission-request' && e.kind !== 'elicitation') return false
      const state = questionState(events, e.requestId)
      return (
        !state.outcome &&
        (e.kind === 'permission-request' || e.kind === 'elicitation' || e.responseMode !== 'message' || state.waiting)
      )
    })
  }

  saveQuestionDraft(id: string, requestId: string, drafts: Record<string, string>): void {
    const child = this.childRequests.get(requestId)
    if (child && child !== id) return this.saveQuestionDraft(child, requestId, drafts)
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
    const child = this.childRequests.get(requestId)
    if (child && child !== id) return this.closeQuestion(child, requestId, outcome, reason)
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
      !request.approvalKey ||
      questionState(this.host.events(id), request.requestId).outcome
    )
      return
    const session = this.host.get(id)
    if (!['running', 'starting', 'needs-input'].includes(session.state)) return
    const approvals = new PermissionApprovals(this.db)
    const scope = approvals.match(
      request.approvalProvider ?? session.provider,
      request.approvalKey,
      approvals.project(session.taskId),
    )
    if (scope) {
      try {
        this.replyPermission(id, request.requestId, true, undefined, scope)
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
  ): void {
    const child = this.childRequests.get(requestId)
    if (child && child !== id) return this.replyPermission(child, requestId, allow, message, scope)
    const request = this.permissionRequest(id, requestId)
    if (request.approvalSessionId && request.approvalSessionId !== id)
      return this.replyPermission(request.approvalSessionId, requestId, allow, message, scope)
    if (questionState(this.host.events(id), requestId).outcome)
      throw new Error('This permission request is already closed.')
    if (scope !== 'once' && (!allow || !request.approvalKey)) throw new Error('This request can only be approved once.')
    const session = this.host.get(id)
    const approvals = new PermissionApprovals(this.db)
    const project = approvals.project(session.taskId)
    if (scope === 'project' && !project) throw new Error('This thread has no project.')
    if (this.host.runners.has(id)) this.host.runners.get(id)!.replyPermission(requestId, allow)
    else {
      const pending = this.takePending(id, requestId, 'permission')
      pending.resolve(
        allow
          ? { behavior: 'allow', updatedInput: pending.input }
          : { behavior: 'deny', message: message || 'Denied by the user' },
      )
    }
    if (allow && scope !== 'once')
      approvals.remember(request.approvalProvider ?? session.provider, request.approvalKey!, scope, project)
    this.host.record(id, {
      kind: 'request-resolved',
      requestId,
      outcome: !allow ? 'denied' : scope === 'once' ? 'allowed' : `allowed-${scope}`,
    })
    this.afterRequest(id)
  }

  forgetPermission(id: string, requestId: string, scope: 'project' | 'user'): void {
    const child = this.childRequests.get(requestId)
    if (child && child !== id) return this.forgetPermission(child, requestId, scope)
    const request = this.permissionRequest(id, requestId)
    if (request.approvalSessionId && request.approvalSessionId !== id)
      return this.forgetPermission(request.approvalSessionId, requestId, scope)
    const outcome = questionState(this.host.events(id), requestId).outcome
    if (!request.approvalKey || outcome !== `allowed-${scope}`)
      throw new Error('This request has no saved approval in that scope.')
    const session = this.host.get(id)
    const approvals = new PermissionApprovals(this.db)
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
    const child = this.childRequests.get(requestId)
    if (child && child !== id) return this.saveElicitationDraft(child, requestId, drafts)
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
    const child = this.childRequests.get(requestId)
    if (child && child !== id) return this.replyElicitation(child, requestId, action, answers)
    this.pendingElicitation(id, requestId)
    const runner = this.host.runners.get(id)
    if (!runner?.replyElicitation) throw new Error('That input request is no longer pending.')
    runner.replyElicitation(requestId, action, answers)
    if (action === 'accept') this.host.record(id, { kind: 'question-state', requestId, answers })
  }

  replyQuestion(id: string, requestId: string, answers: Record<string, string>): void {
    const child = this.childRequests.get(requestId)
    if (child && child !== id) return this.replyQuestion(child, requestId, answers)
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
      const waiting = !!this.questionWaiters.get(`${id}:${requestId}`)?.size
      // Persist delivery before closing the question. Unsent answers use the normal durable queue.
      this.db.exec('SAVEPOINT question_answer')
      try {
        if (status.request.responseMode === 'message' && !waiting) {
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
      if (status.request.responseMode === 'message' && !waiting) {
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
    for (const [key, callbacks] of this.questionWaiters)
      if (key.startsWith(`${id}:`)) for (const cancel of [...callbacks]) cancel(true)
  }
}
