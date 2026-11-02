// Computers this desktop app has paired with. The app stays connected to all of them while it runs.
// Tokens stay in the main process: the renderer only ever sees names and addresses.
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseRemoteUrl, type RuntimeEndpoint } from '@ramu/contracts'

/** A computer reached through an SSH tunnel: `target` is what ssh is given, `remote` the address the tunnel forwards to on that computer. */
export interface SshRoute {
  target: string
  remote: string
}
interface StoredServer {
  id: string
  name: string
  url: string
  pairedAt: number
  token: string
  sealed: boolean
  /** When the token was last rotated; absent means never. */
  renewedAt?: number
  enabled?: boolean
  retryMode?: 'events' | 'periodic'
  ssh?: SshRoute
  /** What pairing bound: this device's id on the host and the host's own durable id. Absent for older pairings. */
  deviceId?: string
  hostId?: string
  /** Other addresses the host named in a proven identity answer; tried only when the saved one stops answering. */
  routes?: string[]
  /** The host's Ramu Link key as the host itself vouched for it; a Link stream proving any other key is refused. */
  linkKey?: string
}
interface StoredFile {
  servers: StoredServer[]
}
export interface SavedServer {
  id: string
  name: string
  url: string
  pairedAt: number
  enabled: boolean
  retryMode: 'events' | 'periodic'
  ssh?: SshRoute
  /** The host's durable id, bound at pairing. */
  hostId?: string
}
export interface PairedIdentity {
  deviceId?: string
  hostId?: string
  linkKey?: string
}
export interface ComputerUpdate {
  name?: string
  enabled?: boolean
  retryMode?: 'events' | 'periodic'
}
export interface Sealer {
  available: boolean
  seal(text: string): string
  open(text: string): string
}

const MAX_NAME = 60
const clean = (text: string | undefined, fallback: string) =>
  (text ?? '')
    // eslint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME) || fallback

export class RemoteServers {
  private signature = ''
  private records = new Map<string, StoredServer>()
  private endpoints = new Map<string, RuntimeEndpoint & { kind: 'http' }>()
  constructor(
    private readonly path: string,
    private readonly sealer: Sealer,
  ) {}

  private load() {
    let signature: string
    try {
      const stat = statSync(this.path)
      signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
    } catch {
      signature = 'missing'
    }
    if (signature === this.signature) return
    this.signature = signature
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      const entries: StoredServer[] = Array.isArray(parsed.servers)
        ? parsed.servers.filter(
            (s: StoredServer) =>
              s && typeof s.id === 'string' && typeof s.url === 'string' && typeof s.token === 'string',
          )
        : []
      const nextRecords = new Map(entries.map((entry) => [entry.id, entry]))
      for (const [id] of this.endpoints) {
        const next = nextRecords.get(id),
          previous = this.records.get(id)
        if (
          !next ||
          !previous ||
          next.token !== previous.token ||
          next.sealed !== previous.sealed ||
          next.url !== previous.url
        )
          this.endpoints.delete(id)
      }
      this.records = nextRecords
    } catch {
      this.records.clear()
      this.endpoints.clear()
    }
  }

  private read(): StoredFile {
    this.load()
    return { servers: [...this.records.values()].map((entry) => ({ ...entry })) }
  }

  private write(file: StoredFile) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(file, null, 2), { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, this.path)
    this.signature = ''
    this.load()
  }

  list(): SavedServer[] {
    return this.read().servers.map(({ id, name, url, pairedAt, enabled, retryMode, ssh, hostId }) => ({
      id,
      name,
      url,
      pairedAt,
      enabled: enabled !== false,
      retryMode: retryMode === 'periodic' ? 'periodic' : 'events',
      ...(ssh ? { ssh } : {}),
      ...(hostId ? { hostId } : {}),
    }))
  }
  get(id: string): SavedServer | undefined {
    this.load()
    const server = this.records.get(id)
    return server
      ? {
          id,
          name: server.name,
          url: server.url,
          pairedAt: server.pairedAt,
          enabled: server.enabled !== false,
          retryMode: server.retryMode === 'periodic' ? 'periodic' : 'events',
          ...(server.ssh ? { ssh: server.ssh } : {}),
          ...(server.hostId ? { hostId: server.hostId } : {}),
        }
      : undefined
  }

  /** The saved computer a host id was bound to at pairing, if any. A hint only: it never authorizes a credential. */
  byHostId(hostId: string): SavedServer | undefined {
    return this.list().find((server) => server.hostId === hostId)
  }

  /** This device's id on the host, kept in the main process to ask the host for its identity proof. */
  deviceIdOf(id: string): string | undefined {
    this.load()
    return this.records.get(id)?.deviceId
  }

  /** What it takes to connect to a saved computer. */
  endpoint(id: string): (RuntimeEndpoint & { kind: 'http' }) | null {
    this.load()
    const cached = this.endpoints.get(id)
    if (cached) return { ...cached }
    const server = this.records.get(id)
    if (!server) return null
    try {
      const endpoint = {
        kind: 'http' as const,
        url: server.url,
        token: server.sealed ? this.sealer.open(server.token) : server.token,
      }
      this.endpoints.set(id, endpoint)
      return { ...endpoint }
    } catch {
      return null
    }
  }

  /** Saves a computer after it accepted a pairing code. Pairing the same address again replaces the old entry. */
  add(
    address: string,
    name: string | undefined,
    token: string,
    now = Date.now(),
    ssh?: SshRoute,
    identity: PairedIdentity = {},
  ): SavedServer {
    const url = parseRemoteUrl(address),
      file = this.read()
    const sealed = this.sealer.available
    // The host's own id says which computer this is, so pairing it again at a new address keeps the saved entry's id and
    // everything keyed to it (drafts, unread state, queued messages). Without an id the address or tunnel target decides.
    const sameHost = identity.hostId
      ? file.servers.find((s) => s.hostId === identity.hostId && !s.ssh === !ssh)
      : undefined
    const sameRoute = file.servers.find((s) => (ssh ? s.ssh?.target === ssh.target : s.url === url))
    const previous = sameHost ?? sameRoute
    const server: StoredServer = {
      id: sameHost?.id ?? randomUUID().slice(0, 8),
      ...(sameHost?.enabled === false ? { enabled: false } : {}),
      ...(sameHost?.retryMode ? { retryMode: sameHost.retryMode } : {}),
      name: clean(name, ssh?.target.replace(/^.*@/, '') ?? new URL(url).hostname),
      url,
      pairedAt: now,
      token: sealed ? this.sealer.seal(token) : token,
      sealed,
      ...(ssh ? { ssh } : {}),
      ...(identity.deviceId ? { deviceId: identity.deviceId } : {}),
      ...(identity.hostId ? { hostId: identity.hostId } : {}),
      ...((identity.linkKey ?? sameHost?.linkKey) ? { linkKey: identity.linkKey ?? sameHost?.linkKey } : {}),
    }
    // The same tunnel target replaces its entry even when the local tunnel port changed.
    this.write({
      servers: [
        ...file.servers.filter(
          (s) => s !== previous && s.id !== server.id && (ssh ? s.ssh?.target !== ssh.target : s.url !== url),
        ),
        server,
      ],
    })
    return {
      id: server.id,
      name: server.name,
      url,
      pairedAt: now,
      enabled: server.enabled !== false,
      retryMode: server.retryMode ?? 'events',
      ...(ssh ? { ssh } : {}),
      ...(identity.hostId ? { hostId: identity.hostId } : {}),
    }
  }

  /** When this computer's token was last rotated, or null. */
  renewedAt(id: string): number | null {
    this.load()
    return this.records.get(id)?.renewedAt ?? null
  }

  /**
   * Stores a renewed token. The write completes before the token is ever used, so a crash leaves the previous token
   * (which the host keeps until the new one's first use) working.
   */
  rotate(id: string, token: string, now = Date.now()) {
    const file = this.read(),
      server = file.servers.find((entry) => entry.id === id)
    if (!server) return
    server.sealed = this.sealer.available
    server.token = server.sealed ? this.sealer.seal(token) : token
    server.renewedAt = now
    this.write(file)
  }

  routesOf(id: string): string[] {
    this.load()
    return this.records.get(id)?.routes ?? []
  }

  setRoutes(id: string, routes: string[]) {
    const file = this.read(),
      server = file.servers.find((entry) => entry.id === id)
    if (!server) return
    if (JSON.stringify(server.routes ?? []) === JSON.stringify(routes)) return
    server.routes = routes
    this.write(file)
  }

  /** The pinned Link key of the saved host with this durable id. */
  linkKeyOf(hostId: string): string | null {
    this.load()
    for (const server of this.records.values()) if (server.hostId === hostId && server.linkKey) return server.linkKey
    return null
  }

  setLinkKey(id: string, linkKey: string) {
    const file = this.read(),
      server = file.servers.find((entry) => entry.id === id)
    if (!server || server.linkKey === linkKey) return
    server.linkKey = linkKey
    this.write(file)
  }

  /** A tunnel that could not reuse its last local port moves to a new one. */
  setUrl(id: string, address: string) {
    const file = this.read(),
      server = file.servers.find((entry) => entry.id === id)
    if (!server) return
    server.url = parseRemoteUrl(address)
    this.write(file)
  }

  update(id: string, changes: ComputerUpdate): SavedServer {
    const file = this.read(),
      server = file.servers.find((entry) => entry.id === id)
    if (!server) throw new Error('That host is no longer saved')
    if (changes.name !== undefined) {
      if (typeof changes.name !== 'string' || !clean(changes.name, '')) throw new Error('Enter a host name')
      server.name = clean(changes.name, server.name)
    }
    if (changes.enabled !== undefined) {
      if (typeof changes.enabled !== 'boolean') throw new Error('Invalid connection setting')
      server.enabled = changes.enabled
    }
    if (changes.retryMode !== undefined) {
      if (!['events', 'periodic'].includes(changes.retryMode)) throw new Error('Invalid retry setting')
      server.retryMode = changes.retryMode
    }
    this.write(file)
    return this.list().find((entry) => entry.id === id)!
  }

  forget(id: string) {
    this.write({ servers: this.read().servers.filter((s) => s.id !== id) })
  }
}
