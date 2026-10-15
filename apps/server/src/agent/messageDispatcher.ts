import { providerName, isAcpProvider } from '@ramu/shared/providers/providers'
import { randomUUID } from 'node:crypto'
import type { AgentSessionInfo, QueuedMessage, Attachment } from '@ramu/shared/types'
import { combineQueued } from './inputQueue'
import { WRITING_STATES } from './constants'
import type { GoalManager } from './goalManager'
import type { ProviderWaits } from './providerWait'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { SessionStarter } from './sessionStarter'
import type { SessionStore } from './sessionStore'
import type { AgentService } from '../agent'

/** What MessageDispatcher needs from the rest of the service. */
export interface MessageDispatcherHost
  extends
    Pick<GoalManager, 'controlGoal' | 'getGoal' | 'setGoal'>,
    Pick<ProviderWaits, 'providerWait' | 'scheduleProvider'>,
    Pick<SessionRecorder, 'activeTools' | 'record'>,
    Pick<SessionRegistry, 'activeWriter' | 'live' | 'runners' | 'transitioning'>,
    Pick<SessionStarter, 'send'>,
    Pick<SessionStore, 'get' | 'queuePaused' | 'queued'> {
  shutdown(): AgentService['shutdown']
}

/** The durable message queue: queuing, steering a running turn, sending queued messages once the checkout is free, and workspace reservations. */
export class MessageDispatcher {
  constructor(private readonly host: MessageDispatcherHost) {}

  private readonly sendingMessages = new Set<string>()

  /** Sessions with a send in flight that has not reached 'running' yet; later submits must queue behind it. */
  readonly startingSends = new Set<string>()

  readonly steering = new Set<string>()

  workspaceReservations = new Set<string>()

  capturing = new Set<string>()

  workspaceQueue = new Set<string>()

  private wakingWorkspace = false

  async withWorkspaceReservation<T>(covers: string[], action: () => Promise<T>): Promise<T> {
    if (
      this.host.activeWriter(covers) ||
      covers.some((cwd) => this.workspaceReservations.has(cwd) || this.capturing.has(cwd))
    )
      throw new Error('Wait for the workspace operation to finish')
    covers.forEach((cwd) => this.workspaceReservations.add(cwd))
    try {
      return await action()
    } finally {
      covers.forEach((cwd) => this.workspaceReservations.delete(cwd))
      this.wakeWorkspaceQueue()
    }
  }

  removeQueued(id: string, messageId: string): void {
    this.host.get(id)
    if (this.sendingMessages.has(messageId)) throw new Error('This message is already being sent.')
    const messages = this.host.queued(id)
    if (!messages.some((message) => message.id === messageId))
      throw new Error('That message has already been sent or removed.')
    this.updateQueue(
      id,
      messages.filter((message) => message.id !== messageId),
    )
  }

  /** Sends one queued message ahead of the rest: steers a running turn, or starts a turn now even while the queue is paused. */
  async sendQueuedNow(id: string, messageId: string): Promise<void> {
    const session = this.host.get(id)
    if (this.sendingMessages.has(messageId)) throw new Error('This message is already being sent.')
    const message = this.host.queued(id).find((entry) => entry.id === messageId)
    if (!message) throw new Error('That message has already been sent or removed.')
    if (WRITING_STATES.includes(session.state)) {
      if (!this.canSteer(session, true))
        throw new Error(
          `${providerName(session.provider)} can't take a message mid-turn. Stop the turn to send it now.`,
        )
      this.updateQueue(
        id,
        this.host.queued(id).map((entry) => (entry.id === messageId ? { ...entry, mode: 'steer' } : entry)),
        false,
      )
      return this.dispatchSteering(id)
    }
    this.updateQueue(
      id,
      this.host.queued(id).filter((entry) => entry.id !== messageId),
    )
    try {
      await this.host.send(id, message.text, message.attachments, message.reviewId)
    } catch (error) {
      this.updateQueue(id, [message, ...this.host.queued(id)])
      throw error
    }
  }

  /**
   * Claude and Codex always steer; other runners say so themselves once running. Where steering cancels the turn,
   * Ramu's own messages (advice, answers, helper reports) are queued so they never throw away the agent's work.
   */
  canSteer(session: AgentSessionInfo, fromUser = false): boolean {
    if (!isAcpProvider(session.provider)) return true
    const runner = this.host.runners.get(session.id)
    return !!runner?.canSteer && (fromUser || !runner.steerInterrupts)
  }

  updateQueue(id: string, messages: QueuedMessage[], paused = this.host.queuePaused(id)): void {
    this.host.record(id, { kind: 'queue', messages, paused })
  }

  /** Stop holds queued messages so they do not fire at a stopped chat. An empty queue has nothing to hold, and a hidden pause would block later resumes. */
  pauseQueue(id: string): void {
    if (this.host.queued(id).length) this.updateQueue(id, this.host.queued(id), true)
  }

  resumeQueue(id: string): void {
    this.host.get(id)
    this.updateQueue(id, this.host.queued(id), false)
    void this.dispatchSteering(id)
    queueMicrotask(() => {
      void this.dispatchQueued(id, true)
    })
  }

  async submit(
    id: string,
    text: string,
    mode: 'queue' | 'steer',
    attachments: Attachment[] = [],
    reviewId?: string,
    fromUser = false,
  ): Promise<void> {
    if (this.goalCommand(id, text, attachments, reviewId)) return
    if (!text.trim() && !attachments.length) throw new Error('Enter a message or attach a file first.')
    if (this.host.transitioning.has(id)) throw new Error('Provider switch in progress. Try again in a moment.')
    const session = this.host.get(id)
    if (!this.canSteer(session, fromUser)) mode = 'queue'
    if (!WRITING_STATES.includes(session.state)) {
      if (this.workspaceBusy(session.covers, id) || this.host.queued(id).length || this.startingSends.has(id)) {
        this.updateQueue(
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
        this.workspaceQueue.add(id)
        this.wakeWorkspaceQueue()
        return
      }
      this.updateQueue(id, this.host.queued(id), false)
      this.startingSends.add(id)
      try {
        return await this.host.send(id, text, attachments, reviewId)
      } finally {
        this.startingSends.delete(id)
        // Messages that arrived while this one was starting go out together once the turn is idle.
        if (this.host.queued(id).length) {
          this.workspaceQueue.add(id)
          this.wakeWorkspaceQueue()
        }
      }
    }
    this.updateQueue(
      id,
      [
        ...this.host.queued(id),
        {
          id: randomUUID(),
          text,
          mode,
          ...(attachments.length ? { attachments } : {}),
          ...(reviewId ? { reviewId } : {}),
        },
      ],
      false,
    )
    // Keep steering visible in the queue until all active tools have finished.
    // Native steering then applies the input without interrupting the current turn.
    if (mode === 'steer') await this.dispatchSteering(id)
  }

  async dispatchSteering(id: string): Promise<void> {
    if (
      this.host.shutdown() ||
      this.host.activeTools.get(id)?.size ||
      this.steering.has(id) ||
      this.host.queuePaused(id) ||
      this.host.transitioning.has(id)
    )
      return
    // With no turn in progress there is nothing to steer; holding the flag would stop dispatchQueued from resuming a failed or stopped chat.
    if (!WRITING_STATES.includes(this.host.get(id).state)) return
    this.steering.add(id)
    try {
      // Brief window so messages sent within milliseconds of each other are steered as one request.
      await new Promise((resolve) => setTimeout(resolve, 75))
      while (
        !this.host.shutdown() &&
        this.host.get(id).state === 'running' &&
        !this.host.queuePaused(id) &&
        !this.host.activeTools.get(id)?.size
      ) {
        const batch = this.host.queued(id).filter((message) => message.mode === 'steer')
        if (!batch.length) break
        const codex = this.host.runners.get(id)
        const live = this.host.live.get(id)
        if (!codex && !live) break
        const combined = combineQueued(batch)
        batch.forEach((message) => this.sendingMessages.add(message.id))
        try {
          if (codex) await codex.steer(combined.text, combined.attachments)
          else live!.input.push(combined.text, combined.attachments)
        } catch (error) {
          // Keep unsent input visible and recoverable; a finishing turn may win the race.
          this.host.record(id, { kind: 'error', message: `Steering message is still pending: ${String(error)}` })
          break
        } finally {
          batch.forEach((message) => this.sendingMessages.delete(message.id))
        }
        const sent = new Set(batch.map((message) => message.id))
        this.updateQueue(
          id,
          this.host.queued(id).filter((entry) => !sent.has(entry.id)),
        )
        this.host.record(id, {
          kind: 'user',
          text: combined.text,
          ...(combined.attachments.length ? { attachments: combined.attachments } : {}),
        })
      }
    } finally {
      this.steering.delete(id)
      const state = this.host.shutdown() ? null : this.host.get(id).state
      if (state === 'idle')
        queueMicrotask(() => {
          void this.dispatchQueued(id)
        })
      // A failed or stopped chat that is waiting on the workspace queue (e.g. a late answer) was refused while this flag was held.
      else if (state && !WRITING_STATES.includes(state) && this.workspaceQueue.has(id)) this.wakeWorkspaceQueue()
    }
  }

  async dispatchQueued(id: string, resumeStopped = false): Promise<void> {
    if (this.host.shutdown()) return
    const state = this.host.get(id).state
    if (this.host.providerWait(id)) {
      this.host.scheduleProvider(id)
      return
    }
    if (
      this.host.shutdown() ||
      this.host.queuePaused(id) ||
      this.steering.has(id) ||
      this.host.transitioning.has(id) ||
      (state !== 'idle' && (!resumeStopped || WRITING_STATES.includes(state)))
    )
      return
    const messages = this.host.queued(id),
      first = messages[0]
    if (!first) return
    // A review follow-up carries its own validation, so it is never merged with other messages.
    const batch = first.reviewId ? [first] : messages.filter((entry) => !entry.reviewId)
    if (this.workspaceBusy(this.host.get(id).covers, id)) {
      this.workspaceQueue.add(id)
      return
    }
    this.workspaceQueue.delete(id)
    const sent = new Set(batch.map((entry) => entry.id))
    this.updateQueue(
      id,
      messages.filter((entry) => !sent.has(entry.id)),
    )
    const combined = combineQueued(batch)
    try {
      await this.host.send(id, combined.text, combined.attachments, combined.reviewId)
    } catch (error) {
      this.updateQueue(id, [...batch, ...this.host.queued(id)], first.reviewId ? true : this.host.queuePaused(id))
      this.host.record(id, { kind: 'error', message: `Queued message was not sent: ${String(error)}` })
    }
  }

  workspaceBusy(covers: string[], self?: string): boolean {
    return (
      !!this.host.activeWriter(covers, self) ||
      covers.some((cwd) => this.capturing.has(cwd) || this.workspaceReservations.has(cwd))
    )
  }

  wakeWorkspaceQueue(): void {
    if (this.wakingWorkspace || this.host.shutdown()) return
    this.wakingWorkspace = true
    queueMicrotask(() => {
      void (async () => {
        try {
          for (const id of this.workspaceQueue) {
            if (this.host.queuePaused(id) || !this.host.queued(id).length) {
              this.workspaceQueue.delete(id)
              continue
            }
            if (!this.workspaceBusy(this.host.get(id).covers, id)) await this.dispatchQueued(id, true)
          }
        } finally {
          this.wakingWorkspace = false
        }
      })().catch(() => {})
    })
  }

  goalCommand(id: string, text: string, attachments: Attachment[] = [], reviewId?: string): boolean {
    const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.split('\n\n<ramu-context>')[0]!.trim())
    if (!match) return false
    const arg = match[1]?.trim()
    if (attachments.length && (!arg || ['pause', 'resume', 'clear'].includes(arg)))
      throw new Error('Goal controls cannot include attachments.')
    if (!arg) {
      this.host.getGoal(id)
      return true
    }
    if (arg === 'pause' || arg === 'resume' || arg === 'clear') this.host.controlGoal(id, arg)
    else {
      this.host.setGoal(id, arg, true)
      this.updateQueue(
        id,
        [
          ...this.host.queued(id),
          {
            id: randomUUID(),
            text: text.replace(/^\s*\/goal\s+/, 'Work toward this Ramu goal: '),
            mode: 'queue',
            ...(attachments.length ? { attachments } : {}),
            ...(reviewId ? { reviewId } : {}),
          },
        ],
        false,
      )
      this.workspaceQueue.add(id)
      this.wakeWorkspaceQueue()
    }
    return true
  }
}
