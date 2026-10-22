import type { ComputerBackend, ComputerGrant } from '@ramu/shared/computerBridge'
import { EvidenceFiles } from './evidence'
import { ComputerSession } from './session'

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
  ) {}

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
      ? new ComputerSession(grant, runtime.backend, this.now, { id: runtime.id, name: runtime.name })
      : new ComputerSession(grant, this.backend, this.now)
    this.sessions.set(threadId, session)
    return session
  }

  /** Devices the owner allowed to watch (and optionally drive) a thread's computer. The owning host is always allowed. */
  private viewers = new Map<string, Map<string, { input: boolean }>>()

  grantViewer(threadId: string, deviceId: string, input: boolean) {
    const devices = this.viewers.get(threadId) ?? new Map()
    devices.set(deviceId, { input })
    this.viewers.set(threadId, devices)
  }

  revokeViewer(threadId: string, deviceId: string) {
    this.viewers.get(threadId)?.delete(deviceId)
    this.session(threadId)?.controllerDisconnected(deviceId)
  }

  listViewers(threadId: string): { deviceId: string; input: boolean }[] {
    return [...(this.viewers.get(threadId) ?? [])].map(([deviceId, { input }]) => ({ deviceId, input }))
  }

  /** `observe` and `input` need an explicit grant for any device but the owning host (`local`). */
  viewerAccess(threadId: string, deviceId: string): { observe: boolean; input: boolean } {
    if (deviceId === 'local') return { observe: true, input: true }
    const entry = this.viewers.get(threadId)?.get(deviceId)
    return { observe: !!entry, input: !!entry?.input }
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
    this.viewers.delete(threadId)
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
