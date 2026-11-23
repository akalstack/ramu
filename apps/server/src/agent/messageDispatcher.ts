import { providerName, isAcpProvider } from '@ramu/shared/providers/providers'
import { randomUUID } from 'node:crypto'
import type { AgentSessionInfo, QueuedMessage, Attachment, MessageOrigin } from '@ramu/shared/types'
import { combineQueued } from './inputQueue'
import { WRITING_STATES } from './constants'
import { currentBranch } from '../workspace/git'
import type { GoalManager } from './goalManager'
import type { ProviderWaits } from './providerWait'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { SessionStarter } from './sessionStarter'
import type { SessionStore } from './sessionStore'
import type { AgentService } from '../agent'

/** How long Send now waits for a stopped turn to end before giving up. */
const STOP_WAIT_MS = 15_000

function withHold(message: QueuedMessage, held: boolean): QueuedMessage {
  const { held: _wasHeld, ...rest } = message
  return held ? { ...rest, held: true } : rest
}

/** What MessageDispatcher needs from the rest of the service. */
export interface MessageDispatcherHost
  extends
    Pick<GoalManager, 'controlGoal' | 'getGoal' | 'setGoal' | 'setVerify'>,
    Pick<ProviderWaits, 'providerWait' | 'scheduleProvider'>,
    Pick<SessionRecorder, 'activeTools' | 'record'>,
    Pick<SessionRegistry, 'live' | 'runners' | 'transitioning'>,
    Pick<SessionStarter, 'send'>,
    Pick<SessionStore, 'get' | 'queuePaused' | 'queued' | 'threadDone'> {
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

  /** A wake that arrived mid-pass; the pass already visited the sessions it could have helped, so it runs again. */
  private wakeAgain = false

  async withWorkspaceReservation<T>(covers: string[], action: () => Promise<T>): Promise<T> {
    if (covers.some((cwd) => this.workspaceReservations.has(cwd) || this.capturing.has(cwd)))
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

  /** A held message waits while the person edits it; releasing it sends it at its usual moment. */
  holdQueued(id: string, messageId: string, held: boolean): void {
    this.host.get(id)
    if (this.sendingMessages.has(messageId)) throw new Error('This message is already being sent.')
    const messages = this.host.queued(id)
    if (!messages.some((message) => message.id === messageId))
      throw new Error('That message has already been sent or removed.')
    this.updateQueue(
      id,
      messages.map((message) => (message.id === messageId ? withHold(message, held) : message)),
    )
    if (!held) this.release(id)
  }

  /** Saving an edit cancels the message and sends the new text in its place, as the newest message. */
  editQueued(id: string, messageId: string, text: string): void {
    this.host.get(id)
    if (!text.trim()) throw new Error('Enter a message, or remove it instead.')
    if (this.sendingMessages.has(messageId)) throw new Error('This message is already being sent.')
    const messages = this.host.queued(id)
    const message = messages.find((entry) => entry.id === messageId)
    if (!message) throw new Error('That message has already been sent or removed.')
    this.updateQueue(id, [
      ...messages.filter((entry) => entry !== message),
      { ...withHold(message, false), id: randomUUID(), text },
    ])
    this.release(id)
  }

  private release(id: string): void {
    void this.dispatchSteering(id)
    queueMicrotask(() => {
      void this.dispatchQueued(id)
    })
  }

  /** Puts the queue in the given order. Messages missing from `order` keep their place at the end; unknown ids are ignored. */
  reorderQueued(id: string, order: string[]): void {
    this.host.get(id)
    const messages = this.host.queued(id)
    const rank = new Map(order.map((messageId, index) => [messageId, index]))
    const sorted = [...messages].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
    if (sorted.every((message, index) => message.id === messages[index]!.id)) return
    this.updateQueue(id, sorted)
  }

  /**
   * Sends one queued message ahead of the rest: steers a running turn, or starts a turn now even while the queue is
   * paused. With `interrupt`, a running turn is stopped first and the message starts the next one.
   */
  async sendQueuedNow(id: string, messageId: string, interrupt = false): Promise<void> {
    const session = this.host.get(id)
    if (this.sendingMessages.has(messageId)) throw new Error('This message is already being sent.')
    const message = this.host.queued(id).find((entry) => entry.id === messageId)
    if (!message) throw new Error('That message has already been sent or removed.')
    if (message.checkout) {
      this.sendingMessages.add(messageId)
      try {
        await this.validateCheckout(message)
      } finally {
        this.sendingMessages.delete(messageId)
      }
      if (this.host.providerWait(id)) {
        this.host.scheduleProvider(id)
        return
      }
    }
    if (WRITING_STATES.includes(session.state)) {
      if (interrupt) return this.interruptAndSend(id, message)
      if (!this.canSteer(session, true))
        throw new Error(
          `${providerName(session.provider)} can't take a message mid-turn. Stop the turn to send it now.`,
        )
      this.updateQueue(
        id,
        this.host
          .queued(id)
          .map((entry) => (entry.id === messageId ? { ...withHold(entry, false), mode: 'steer' } : entry)),
        false,
      )
      return this.dispatchSteering(id)
    }
    this.updateQueue(
      id,
      this.host.queued(id).filter((entry) => entry.id !== messageId),
    )
    try {
      await this.sendMessage(id, message)
    } catch (error) {
      this.updateQueue(id, [message, ...this.host.queued(id)])
      throw error
    }
  }

  /**
   * Stops the running turn and sends `message` as the next one. The rest of the queue is held meanwhile so it cannot
   * go out first, and keeps its own paused state afterwards; if the send fails, the message returns to the front of a
   * paused queue. Goals keep running: this redirects the turn, not the goal.
   */
  private async interruptAndSend(id: string, message: QueuedMessage): Promise<void> {
    let paused = this.host.queuePaused(id)
    this.sendingMessages.add(message.id)
    this.updateQueue(
      id,
      this.host.queued(id).filter((entry) => entry.id !== message.id),
      true,
    )
    try {
      const runner = this.host.runners.get(id)
      if (runner) await runner.interrupt()
      else await this.host.live.get(id)?.query.interrupt()
      const deadline = Date.now() + STOP_WAIT_MS
      while (WRITING_STATES.includes(this.host.get(id).state)) {
        if (this.host.shutdown() || Date.now() > deadline)
          throw new Error('The turn did not stop in time. Stop it, then send the message.')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      await this.sendMessage(id, message)
    } catch (error) {
      paused = true
      this.updateQueue(id, [message, ...this.host.queued(id)], true)
      throw error
    } finally {
      this.sendingMessages.delete(message.id)
      if (!this.host.shutdown()) this.updateQueue(id, this.host.queued(id), paused)
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

  /** Durable background input; preserve a user's paused queue and never steer a running turn. */
  enqueueBackground(id: string, text: string, checkout: NonNullable<QueuedMessage['checkout']>): void {
    this.host.get(id)
    const message: QueuedMessage = { id: randomUUID(), text, mode: 'queue', checkout }
    if (this.host.threadDone(id)) return this.updateQueue(id, [...this.host.queued(id), message], true)
    this.updateQueue(id, [...this.host.queued(id), message])
    this.workspaceQueue.add(id)
    this.wakeWorkspaceQueue()
  }

  /** Re-register durable background messages after a service restart without unpausing user input. */
  wakeBackground(id: string): void {
    if (this.host.queuePaused(id) || !this.host.queued(id).some((message) => message.checkout)) return
    if (['needs-input', 'stopped', 'failed'].includes(this.host.get(id).state)) return
    this.workspaceQueue.add(id)
    this.wakeWorkspaceQueue()
  }

  private async validateCheckout(message: QueuedMessage): Promise<void> {
    if (message.checkout && (await currentBranch(message.checkout.cwd)) !== message.checkout.branch)
      throw new Error(`Pull request feedback is waiting for branch ${message.checkout.branch}. Switch back to send it.`)
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
    from?: MessageOrigin,
  ): Promise<void> {
    // Only the person sets a goal: its `verify:` command runs as a shell command without approval, so a message from a
    // paired host, a terminal, a helper or another agent is never read as one.
    if (fromUser && !from && this.goalCommand(id, text, attachments, reviewId)) return
    if (!text.trim() && !attachments.length) throw new Error('Enter a message or attach a file first.')
    if (this.host.transitioning.has(id)) throw new Error('Provider switch in progress. Try again in a moment.')
    const session = this.host.get(id)
    // A done thread takes no turn the person did not start; other agents' messages wait in a paused queue.
    if (!fromUser && !reviewId && this.host.threadDone(id)) {
      this.updateQueue(
        id,
        [
          ...this.host.queued(id),
          {
            id: randomUUID(),
            text,
            mode: 'queue',
            ...(attachments.length ? { attachments } : {}),
            ...(from ? { from } : {}),
          },
        ],
        true,
      )
      return
    }
    if (!this.canSteer(session, fromUser)) mode = 'queue'
    if (!WRITING_STATES.includes(session.state)) {
      if (this.workspaceBusy(session.covers) || this.host.queued(id).length || this.startingSends.has(id)) {
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
              ...(from ? { from } : {}),
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
        return await this.sendMessage(id, { text, attachments, reviewId, from })
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
          ...(from ? { from } : {}),
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
        const batch = this.host.queued(id).filter((message) => message.mode === 'steer' && !message.held)
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
          ...(batch.length === 1 && batch[0]!.from ? { from: batch[0]!.from } : {}),
          steered: true,
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
    // Order holds: a message the person is editing keeps everything after it waiting too.
    if (!first || first.held || this.sendingMessages.has(first.id)) return
    if (this.workspaceBusy(this.host.get(id).covers)) {
      this.workspaceQueue.add(id)
      return
    }
    this.workspaceQueue.delete(id)
    // Like Codex and Claude Code, each queued message gets its own turn; the rest wait for that turn to finish.
    this.updateQueue(id, messages.slice(1))
    try {
      if (first.checkout) await this.validateCheckout(first)
      await this.sendMessage(id, {
        text: first.text,
        attachments: first.attachments ?? [],
        ...(first.reviewId ? { reviewId: first.reviewId } : {}),
        from: first.from,
      })
    } catch (error) {
      this.updateQueue(
        id,
        [first, ...this.host.queued(id)],
        first.reviewId || first.checkout ? true : this.host.queuePaused(id),
      )
      this.host.record(id, { kind: 'error', message: `Queued message was not sent: ${String(error)}` })
    }
  }

  private sendMessage(
    id: string,
    message: { text: string; attachments?: Attachment[]; reviewId?: string; from?: MessageOrigin },
  ): Promise<void> {
    // A person's `/goal` is handled when they submit it, so a queued or steered message is never a goal command.
    return this.host.send(
      id,
      message.text,
      message.attachments,
      message.reviewId,
      true,
      undefined,
      false,
      message.from,
      false,
    )
  }

  /**
   * Threads in one checkout work side by side; each turn's changes are told apart by who wrote them. A message waits
   * only while an undo, commit or branch switch rewrites that checkout's files.
   */
  workspaceBusy(covers: string[]): boolean {
    return covers.some((cwd) => this.workspaceReservations.has(cwd))
  }

  wakeWorkspaceQueue(): void {
    if (this.host.shutdown()) return
    if (this.wakingWorkspace) {
      this.wakeAgain = true
      return
    }
    this.wakingWorkspace = true
    queueMicrotask(() => {
      void (async () => {
        try {
          for (const id of this.workspaceQueue) {
            if (this.host.queuePaused(id) || !this.host.queued(id).length) {
              this.workspaceQueue.delete(id)
              continue
            }
            if (!this.workspaceBusy(this.host.get(id).covers)) await this.dispatchQueued(id, true)
          }
        } finally {
          this.wakingWorkspace = false
          if (this.wakeAgain) {
            this.wakeAgain = false
            this.wakeWorkspaceQueue()
          }
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
    // `/goal verify: <command>` sets the command Ramu runs when the agent claims completion; `/goal verify: off` removes it.
    const verifyOnly = /^verify:\s*([\s\S]+)$/i.exec(arg)
    if (verifyOnly) this.host.setVerify(id, /^off$/i.test(verifyOnly[1]!.trim()) ? null : verifyOnly[1]!)
    else if (arg === 'pause' || arg === 'resume' || arg === 'clear') this.host.controlGoal(id, arg)
    else {
      // A last line of `verify: <command>` in a new goal sets its command.
      const line = /\n[ \t]*verify:[ \t]*(\S.*)$/i.exec(arg)
      this.host.setGoal(id, line ? arg.slice(0, line.index).trim() : arg, true, line?.[1])
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
