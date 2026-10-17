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
  enabled?: boolean
  retryMode?: 'events' | 'periodic'
  ssh?: SshRoute
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
    return this.read().servers.map(({ id, name, url, pairedAt, enabled, retryMode, ssh }) => ({
      id,
      name,
      url,
      pairedAt,
      enabled: enabled !== false,
      retryMode: retryMode === 'periodic' ? 'periodic' : 'events',
      ...(ssh ? { ssh } : {}),
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
        }
      : undefined
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
  add(address: string, name: string | undefined, token: string, now = Date.now(), ssh?: SshRoute): SavedServer {
    const url = parseRemoteUrl(address),
      file = this.read()
    const sealed = this.sealer.available
    const server: StoredServer = {
      id: randomUUID().slice(0, 8),
      name: clean(name, ssh?.target.replace(/^.*@/, '') ?? new URL(url).hostname),
      url,
      pairedAt: now,
      token: sealed ? this.sealer.seal(token) : token,
      sealed,
      ...(ssh ? { ssh } : {}),
    }
    // The same tunnel target replaces its entry even when the local tunnel port changed.
    this.write({
      servers: [...file.servers.filter((s) => (ssh ? s.ssh?.target !== ssh.target : s.url !== url)), server],
    })
    return {
      id: server.id,
      name: server.name,
      url,
      pairedAt: now,
      enabled: true,
      retryMode: 'events',
      ...(ssh ? { ssh } : {}),
    }
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
