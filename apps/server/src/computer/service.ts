import type { ComputerBackend, ComputerGrant } from '@ramu/shared/computerBridge'
import { ComputerSession } from './session'

/** Sessions keyed by thread. A grant is bound to one target; a different target needs a new matching grant. */
export class ComputerService {
  private sessions = new Map<string, ComputerSession>()
  constructor(
    readonly backend: ComputerBackend,
    private readonly now: () => number = Date.now,
  ) {}

  status() {
    return this.backend.status()
  }

  /** Called from an approved person action (never from a tool). Replaces and revokes any earlier grant. */
  grant(threadId: string, grant: ComputerGrant): ComputerSession {
    this.sessions.get(threadId)?.revoke()
    const session = new ComputerSession(grant, this.backend, this.now)
    this.sessions.set(threadId, session)
    return session
  }

  session(threadId: string): ComputerSession | undefined {
    return this.sessions.get(threadId)
  }

  revoke(threadId: string) {
    this.sessions.get(threadId)?.revoke()
    this.sessions.delete(threadId)
  }

  /** The run exited or Stop was pressed: revoke its lease and queued actions; the grant stays for the next run. */
  endRun(threadId: string, runId: string) {
    this.sessions.get(threadId)?.stop(runId)
  }
}
