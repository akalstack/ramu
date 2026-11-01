import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { runtimeInvoke, runtimePair, runtimeRenew } from '@ramu/client-runtime'
import type { AgentHostSummary } from '@ramu/shared/types'
import { HostCredentialStore, type HostCredentialScope } from '../credentials/store'
import type { Workspace } from '../workspace/workspace'

const KEY = 'agent-hosts'
/** Renew a pairing's token this long before it would expire. */
const RENEW_BEFORE_MS = 14 * 24 * 60 * 60_000

interface AgentHost {
  id: string
  name: string
  address: string
  /** This host's device id on the other host, to recognise it in that host's device list. */
  deviceId: string
  credential: string
  expiresAt: number | null
  addedAt: number
}

interface Index {
  /** Scopes this host's credentials; created once. */
  hostId: string
  hosts: AgentHost[]
}

/**
 * Other Ramu hosts this host's agents may start threads on. A person at this host adds one with a pairing code from that
 * host, which pairs this host there as a `host` device: limited to starting, checking and messaging the threads it
 * starts, under that host's access ceiling. The token stays in the OS credential store; forgetting removes it here, and
 * revoking it on the other host ends it there.
 */
export class AgentHostService {
  constructor(
    private readonly workspace: Workspace,
    private readonly credentials = new HostCredentialStore(),
  ) {}

  private index(): Index {
    const index = this.workspace.getAppState<Index | null>(KEY, null)
    if (index?.hostId) return index
    const created = { hostId: randomUUID(), hosts: [] }
    this.workspace.setAppState(KEY, created)
    return created
  }

  private scope(index: Index, host: Pick<AgentHost, 'id'>): HostCredentialScope {
    return { hostId: index.hostId, integration: 'host-pairing', connectionId: host.id, accountId: 'device' }
  }

  list(): AgentHostSummary[] {
    return this.index().hosts.map(({ id, name, address, deviceId, expiresAt, addedAt }) => ({
      id,
      name,
      address,
      deviceId,
      expiresAt,
      addedAt,
    }))
  }

  /** The host a name in an agent's words points at: exact name first, then a unique name that starts with it. */
  find(named: string): AgentHostSummary | null {
    const wanted = named.trim().toLowerCase()
    const hosts = this.list()
    const exact = hosts.filter((host) => host.name.toLowerCase() === wanted || host.id === named)
    if (exact.length === 1) return exact[0]!
    const partial = hosts.filter((host) => host.name.toLowerCase().includes(wanted))
    return partial.length === 1 ? partial[0]! : null
  }

  async add(address: string, code: string, name?: string): Promise<AgentHostSummary> {
    const trimmed = address.trim()
    if (!/^https?:\/\//i.test(trimmed)) throw new Error('Enter the host’s address, such as http://100.64.0.2:7788.')
    const label = name?.trim().slice(0, 80) || new URL(trimmed).hostname
    if (this.list().some((host) => host.name.toLowerCase() === label.toLowerCase()))
      throw new Error(`A host named ${label} is already added. Choose another name.`)
    const paired = await runtimePair(trimmed, code.trim(), `${hostname()} (agents)`, 'host')
    const index = this.index()
    const host = {
      id: randomUUID(),
      name: label,
      address: trimmed,
      deviceId: paired.deviceId,
      credential: '',
      expiresAt: paired.expiresAt ?? null,
      addedAt: Date.now(),
    }
    host.credential = await this.credentials.put(this.scope(index, host), paired.token)
    this.workspace.setAppState(KEY, { ...index, hosts: [...index.hosts, host] })
    return this.list().find((entry) => entry.id === host.id)!
  }

  async forget(id: string): Promise<void> {
    const index = this.index()
    const host = index.hosts.find((entry) => entry.id === id)
    if (!host) return
    this.workspace.setAppState(KEY, { ...index, hosts: index.hosts.filter((entry) => entry.id !== id) })
    await this.credentials.remove(this.scope(index, host), host.credential).catch(() => {})
  }

  /** Calls a method the other host allows a host pairing to make. Its answers and refusals are returned as they are. */
  async invoke(id: string, method: string, args: unknown[], operationKey?: string): Promise<unknown> {
    const index = this.index()
    const host = index.hosts.find((entry) => entry.id === id)
    if (!host) throw new Error('That host is no longer added for agents.')
    const token = await this.credentials.read(this.scope(index, host), host.credential)
    return runtimeInvoke({ kind: 'http', url: host.address, token }, method, args, {
      timeoutMs: 30_000,
      ...(operationKey ? { operationKey } : {}),
    })
  }

  /** Renews tokens that expire soon, so a pairing keeps working while this host runs. Failures retry next time. */
  async renew(now = Date.now()): Promise<void> {
    for (const host of this.index().hosts) {
      if (host.expiresAt === null || host.expiresAt - now > RENEW_BEFORE_MS) continue
      try {
        const index = this.index()
        const token = await this.credentials.read(this.scope(index, host), host.credential)
        const renewed = await runtimeRenew(host.address, token)
        if (!renewed) continue
        await this.credentials.update(this.scope(index, host), host.credential, renewed.token)
        const latest = this.index()
        this.workspace.setAppState(KEY, {
          ...latest,
          hosts: latest.hosts.map((entry) =>
            entry.id === host.id ? { ...entry, expiresAt: renewed.expiresAt } : entry,
          ),
        })
      } catch {
        // Offline or refused: the next renewal pass tries again, and a revoked pairing simply stops working.
      }
    }
  }
}
