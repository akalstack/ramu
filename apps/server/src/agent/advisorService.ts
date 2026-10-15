import { providerName } from '@ramu/shared/providers'
import { randomUUID } from 'node:crypto'
import type { AdviceStatus, FallbackStep, AppPreferences, AgentTask, AgentSessionInfo } from '@ramu/shared/types'
import { ADVISOR_TIMEOUT_MS, advisorPrompt } from './advisor'
import { adviceMessage, advisorAgentId } from '@ramu/shared/agentTasks'
import type { AdviceRequest } from './types'
import { WRITING_STATES } from './constants'
import { errorMessage } from './util'
import { transcriptOf } from './handoff'
import type { BackgroundAnalysis } from './backgroundAnalysis'
import type { MessageDispatcher } from './messageDispatcher'
import type { SessionRecorder } from './sessionRecorder'
import type { FallbackRouter } from './fallbackRouter'
import type { SessionStore } from './sessionStore'
import type { AgentTasks } from './agentTasks'
import type { AgentService } from '../agent'

/** What AdvisorService needs from the rest of the service. */
export interface AdvisorServiceHost
  extends
    Pick<BackgroundAnalysis, 'analyze'>,
    Pick<MessageDispatcher, 'canSteer' | 'dispatchSteering' | 'updateQueue' | 'wakeWorkspaceQueue' | 'workspaceQueue'>,
    Pick<SessionRecorder, 'record'>,
    Pick<FallbackRouter, 'withStep'>,
    Pick<SessionStore, 'events' | 'get' | 'queued' | 'task'>,
    Pick<AgentTasks, 'updateTask'> {
  preferences(): AppPreferences | undefined
  shutdown(): AgentService['shutdown']
}

/** Ramu's advisor: consultations a main chat asks for, and delivery of advice nobody waited for. */
export class AdvisorService {
  constructor(private readonly host: AdvisorServiceHost) {}

  private readonly adviceRequests = new Map<string, AdviceRequest>()

  /** Whether Ramu's advisor is on. While it is, Claude Code's own advisor is off in every Ramu Claude chat. */
  advisorOn(): boolean {
    const advisor = this.host.preferences()?.advisor
    return !!advisor?.enabled && !!advisor.step
  }

  /** The advisor step for a chat: main chats only, like ramu_agent. */
  advisorStep(id: string): FallbackStep | null {
    return this.advisorOn() && !this.host.get(id).parentId ? this.host.preferences()!.advisor.step : null
  }

  /**
   * Sends the chat so far to the advisor. Without wait it returns at once; the advice is then delivered like a late
   * async answer (steering the running turn, or starting the next one) unless the agent waits for it first.
   */
  async consultAdvisor(
    id: string,
    input: { focus?: string; wait?: boolean },
    signal?: AbortSignal,
  ): Promise<AdviceStatus> {
    const step = this.advisorStep(id)
    if (!step) throw new Error('The advisor is turned off in Ramu settings.')
    if (this.host.shutdown()) throw new Error('Background service is stopping')
    const session = this.host.get(id)
    const wait = !!input.wait || !!this.host.preferences()?.advisor.wait
    const requestId = randomUUID()
    const abort = new AbortController()
    const request: AdviceRequest = {
      sessionId: id,
      waiters: 0,
      status: { requestId, status: 'pending' },
      abort,
      done: Promise.resolve(),
    }
    // The consultation shows as a card like a sub-agent; its panel holds the question and the advice.
    const agentId = advisorAgentId(requestId),
      startedAt = Date.now()
    const question = input.focus?.trim() || 'Review the conversation so far.'
    this.host.updateTask(id, agentId, {
      name: 'Advisor',
      taskType: 'advisor',
      status: 'running',
      background: !wait,
      summary: 'Reviewing the conversation…',
      provider: step.provider,
      model: step.model,
      effort: step.effort,
      startedAt,
      canStop: true,
      canMessage: false,
    })
    this.host.record(id, { kind: 'user', text: question, agentId })
    const transcript = transcriptOf(this.host.events(id))
    const finish = (patch: Partial<AgentTask>) => {
      // Stopped from its card, or with the chat: the card keeps that state.
      if (this.host.task(id, agentId)?.status !== 'running') return
      this.host.updateTask(id, agentId, { ...patch, endedAt: Date.now(), durationMs: Date.now() - startedAt })
    }
    request.done = this.host
      .analyze(
        advisorPrompt(session.cwd, transcript, input.focus),
        { ...this.host.withStep(session.settings, step), autoFallback: session.settings.autoFallback },
        40_000,
        { timeoutMs: ADVISOR_TIMEOUT_MS, signal: abort.signal },
      )
      .then(
        ({ message, provider, model }) => {
          request.status = {
            requestId,
            status: 'ready',
            advice: message,
            advisor: `${model || 'default model'} · ${providerName(provider)}`,
          }
          if (this.host.task(id, agentId)?.status === 'running')
            this.host.record(id, { kind: 'text', text: message, agentId })
          finish({ status: 'completed', summary: message, provider, model })
        },
        (error) => {
          request.status = { requestId, status: 'failed', error: errorMessage(error) }
          finish({
            status: request.abort.signal.aborted ? 'stopped' : 'failed',
            summary: '',
            error: request.abort.signal.aborted ? undefined : errorMessage(error),
          })
        },
      )
      .then(() => {
        if (!request.waiters) this.deliverAdvice(request)
      })
    this.adviceRequests.set(requestId, request)
    for (const key of [...this.adviceRequests.keys()].slice(0, -50)) this.adviceRequests.delete(key)
    if (wait) return this.waitForAdvice(id, requestId, signal, true)
    return {
      ...request.status,
      note: 'The advice will arrive as a message. Until then continue only with work it cannot change; call wait_for_advice before work that depends on it.',
    }
  }

  async waitForAdvice(id: string, requestId: string, signal?: AbortSignal, owner = false): Promise<AdviceStatus> {
    const request = this.adviceRequests.get(requestId)
    if (!request || request.sessionId !== id) throw new Error('Unknown advisor request. Call advisor again.')
    if (request.status.status !== 'pending') return request.status
    if (signal?.aborted) throw new Error('Advisor wait was cancelled.')
    request.waiters++
    let stop: (() => void) | undefined
    try {
      await Promise.race([
        request.done,
        new Promise<never>((_resolve, reject) => {
          stop = () => {
            if (owner) request.abort.abort()
            reject(new Error('Advisor wait was cancelled.'))
          }
          signal?.addEventListener('abort', stop, { once: true })
        }),
      ])
      return request.status
    } finally {
      request.waiters--
      if (stop) signal?.removeEventListener('abort', stop)
    }
  }

  /** Advice nobody waited for goes into the chat like a late async answer, unless the user stopped the chat. */
  private deliverAdvice(request: AdviceRequest): void {
    const { sessionId: id, status } = request
    if (this.host.shutdown() || request.abort.signal.aborted) return
    let session: AgentSessionInfo
    try {
      session = this.host.get(id)
    } catch {
      return
    }
    const active = WRITING_STATES.includes(session.state)
    // A failed request only matters to a turn that may still be waiting on it.
    if (status.status === 'failed' ? !active : !active && session.state !== 'idle') return
    const text = adviceMessage(status)
    const mode = this.host.canSteer(session) ? 'steer' : 'queue'
    this.host.updateQueue(id, [...this.host.queued(id), { id: randomUUID(), text, mode }], false)
    this.host.workspaceQueue.add(id)
    queueMicrotask(() => {
      void this.host.dispatchSteering(id)
      this.host.wakeWorkspaceQueue()
    })
  }

  /** Aborts the consultation behind an advisor card, if it is still running. */
  abortAdvice(agentId: string): void {
    this.adviceRequests.get(agentId.replace(/^advisor-/, ''))?.abort.abort()
  }
}
