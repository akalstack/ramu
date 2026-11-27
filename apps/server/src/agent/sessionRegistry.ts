import type { AgentRunner } from './agentRunner'
import type { AgentSessionInfo } from '@ramu/shared/types'
import type { LiveSession } from './types'
import { WRITING_STATES } from './constants'
import type { MessageDispatcher } from './messageDispatcher'
import type { SessionStore } from './sessionStore'

/** What SessionRegistry needs from the rest of the service. */
export interface SessionRegistryHost
  extends
    Pick<MessageDispatcher, 'wakeWorkspaceQueue'>,
    Pick<SessionStore, 'get' | 'hasRunningEditors' | 'hasRunningTasks' | 'rootOf'> {}

/** Which sessions have a live process, are draining, switching provider or capturing changes, and who may write in a checkout. */
export class SessionRegistry {
  constructor(private readonly host: SessionRegistryHost) {}

  readonly live = new Map<string, LiveSession>()

  readonly runners = new Map<string, AgentRunner>()

  readonly draining = new Map<string, Promise<void>>()

  readonly transitioning = new Set<string>()

  private readonly closing = new Set<string>()

  finalizing = new Map<string, Promise<void>>()

  readonly revisions = new Map<string, number>()

  /**
   * A live session that may write in any of these checkout directories, if one exists. A chat whose turn is over
   * but whose sub-agents or background tasks still run keeps the checkout; `self` is exempt from that part, so its
   * own follow-ups are not held back by its own helpers.
   */
  activeWriter(covers: string[], self?: string): AgentSessionInfo | null {
    for (const id of new Set([
      ...this.live.keys(),
      ...this.runners.keys(),
      ...this.transitioning,
      ...this.closing,
      ...this.finalizing.keys(),
    ])) {
      // A chat and its own sub-agents are one writer.
      if (self && id !== self && this.host.rootOf(id) === this.host.rootOf(self)) continue
      const s = this.host.get(id)
      if (
        (this.transitioning.has(id) ||
          this.closing.has(id) ||
          this.finalizing.has(id) ||
          WRITING_STATES.includes(s.state) ||
          (id !== self && this.pendingBackground(id))) &&
        s.covers.some((c) => covers.includes(c))
      )
        return s
    }
    return null
  }

  /** Whether this chat, or one of its own sub-agents, may still write: its own changes are not settled yet. */
  writing(id: string): boolean {
    const root = this.host.rootOf(id)
    for (const other of new Set([
      ...this.live.keys(),
      ...this.runners.keys(),
      ...this.transitioning,
      ...this.closing,
      ...this.finalizing.keys(),
    ]))
      if (
        this.host.rootOf(other) === root &&
        (this.transitioning.has(other) ||
          this.closing.has(other) ||
          this.finalizing.has(other) ||
          WRITING_STATES.includes(this.host.get(other).state) ||
          this.pendingBackground(other))
      )
        return true
    return false
  }

  /** The process is still alive and has sub-agents or background tasks running after its turn ended. */
  /** Whether a sub-agent of this live chat may still edit files after its turn, so its changes wait to be captured. */
  pendingEditors(id: string): boolean {
    return (this.live.has(id) || this.runners.has(id)) && this.host.hasRunningEditors(id)
  }

  pendingBackground(id: string): boolean {
    return (this.live.has(id) || this.runners.has(id)) && this.host.hasRunningTasks(id)
  }

  trackDrain(id: string, promise: Promise<void>): void {
    this.closing.add(id)
    this.draining.set(id, promise)
    void promise
      .finally(() => {
        if (this.draining.get(id) === promise) this.closing.delete(id)
        this.host.wakeWorkspaceQueue()
      })
      .catch(() => {})
  }
}
