import type { ComputerBackend, ComputerGrant } from '@ramu/shared/computerBridge'
import { EvidenceFiles } from './evidence'
import { ComputerSession } from './session'
import { TargetClaims } from './claims'

/** Sessions keyed by thread. A grant is bound to one target; a different target needs a new matching grant. */
export class ComputerService {
  private sessions = new Map<string, ComputerSession>()
  private accessRuns = new Map<string, Set<string>>()
  rememberAccessRun(threadId: string, runId: string) {
    const runs = this.accessRuns.get(threadId) ?? new Set<string>()
    runs.add(runId)
    this.accessRuns.set(threadId, runs)
  }
  private accessRequests = new Map<string, 'pending' | 'denied'>()
  accessRequest(runId: string) {
    return this.accessRequests.get(runId)
  }
  beginAccessRequest(runId: string) {
    this.accessRequests.set(runId, 'pending')
  }
  finishAccessRequest(runId: string, denied: boolean) {
    if (denied) this.accessRequests.set(runId, 'denied')
    else this.accessRequests.delete(runId)
  }
  constructor(
    readonly backend: ComputerBackend,
    private readonly now: () => number = Date.now,
  ) {
    this.claims = new TargetClaims(now)
  }
  /** One claim per display or app across every thread's session. */
  private readonly claims: TargetClaims

  /** Screenshots handed to providers that do not show MCP images; removed with the run or the grant. */
  readonly evidence = new EvidenceFiles()

  status() {
    return this.backend.status()
  }

  /** Called after explicit approval or the enabled host’s Full access policy. Replaces and revokes any earlier grant. */
  grant(
    threadId: string,
    grant: ComputerGrant,
    runtime?: { id: string; name: string; backend: ComputerBackend },
  ): ComputerSession {
    this.sessions.get(threadId)?.revoke()
    void this.evidence.clear(threadId)
    const session = runtime
      ? new ComputerSession(grant, runtime.backend, this.now, { id: runtime.id, name: runtime.name }, this.claims)
      : new ComputerSession(grant, this.backend, this.now, undefined, this.claims)
    this.sessions.set(threadId, session)
    return session
  }

  /** Thread metadata only; grants and evidence remain private to the service. */
  sessionThreads(): string[] {
    return [...this.sessions.keys()]
  }

  session(threadId: string): ComputerSession | undefined {
    return this.sessions.get(threadId)
  }

  revoke(threadId: string) {
    for (const run of this.accessRuns.get(threadId) ?? []) this.accessRequests.set(run, 'denied')
    this.accessRuns.delete(threadId)
    this.sessions.get(threadId)?.revoke()
    this.sessions.delete(threadId)
    void this.evidence.clear(threadId)
  }

  /** The run exited or Stop was pressed: revoke its lease and queued actions; the grant stays for the next run. */
  endRun(threadId: string, runId: string) {
    this.accessRequests.delete(runId)
    this.accessRuns.get(threadId)?.delete(runId)
    this.sessions.get(threadId)?.stop(runId)
    void this.evidence.clear(threadId)
  }
}
