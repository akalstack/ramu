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

  session(threadId: string): ComputerSession | undefined {
    return this.sessions.get(threadId)
  }

  revoke(threadId: string) {
    this.sessions.get(threadId)?.revoke()
    this.sessions.delete(threadId)
    this.viewers.delete(threadId)
  }

  /** The run exited or Stop was pressed: revoke its lease and queued actions; the grant stays for the next run. */
  endRun(threadId: string, runId: string) {
    this.sessions.get(threadId)?.stop(runId)
  }
}
