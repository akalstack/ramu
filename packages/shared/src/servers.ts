// Servers a thread's work is listening on. Pure parsing and ownership, so the service stays a thin reader and tests need
// no `lsof`.
import type { ProcessRoot, ProcessRow, ResourceItem } from './resources'

/** The environment variable every agent and terminal Ramu starts carries, naming the item that started it. */
export const OWNER_ENV = 'RAMU_OWNER'

export interface ListeningSocket {
  pid: number
  port: number
  /** The address to reach it on: an IPv6-only listener is not on 127.0.0.1. */
  host: '127.0.0.1' | '::1'
  /** The executable's short name, such as `node` or `adb`. */
  process: string
}

export interface ThreadServer {
  taskId: string
  port: number
  pid: number
  host: ListeningSocket['host']
  process: string
  /** Whether it answered HTTP, so it can be opened as a page. */
  web: boolean
  /** The agent, terminal or command that started it. */
  owner: Omit<ResourceItem, 'rssBytes'>
  /** Its owner has ended; the server outlived it and is easy to forget. */
  orphaned: boolean
  /** A build tool's daemon kept up between builds, such as `Gradle daemon`: never opened, and safe to stop at any time. */
  daemon?: string
}

/**
 * Build tools that leave a daemon listening between builds, by what their command line names. Matched on the command
 * and environment `ps -Eww` prints, so each pattern is a class or binary no environment variable carries.
 */
const BUILD_DAEMONS: readonly [RegExp, string][] = [
  [/org\.gradle\.launcher\.daemon\.bootstrap\.GradleDaemon/, 'Gradle daemon'],
  [/worker\.org\.gradle\.process\.internal\.worker\.GradleWorkerMain/, 'Gradle worker'],
  [/org\.jetbrains\.kotlin\.daemon\.KotlinCompileDaemon/, 'Kotlin daemon'],
  [/A-server\.jar|--server_jvm_out/, 'Bazel server'],
  [/(^|\/)sccache(\s|$)/, 'sccache'],
]

/** The build daemon a process is, from its command line, or null for anything else. */
export function buildDaemon(command: string): string | null {
  return BUILD_DAEMONS.find(([pattern]) => pattern.test(command))?.[1] ?? null
}

/**
 * Listening TCP sockets from `lsof -nP -iTCP -sTCP:LISTEN -F pcn`: a `p` line starts a process, `c` names it, and each `n`
 * is one address. The same port on IPv4 and IPv6 is one server.
 */
export function parseListening(text: string): ListeningSocket[] {
  const sockets = new Map<string, ListeningSocket>()
  let pid = 0
  let process = ''
  for (const line of text.split('\n')) {
    const field = line[0]
    const value = line.slice(1).trim()
    if (field === 'p') {
      pid = Number(value)
      process = ''
    } else if (field === 'c') process = value
    else if (field === 'n' && pid > 0) {
      const match = /^(\*|\[[^\]]*\]|[^:]+):(\d+)$/.exec(value)
      if (!match) continue
      const port = Number(match[2])
      if (!port) continue
      const address = match[1]!
      const ipv6 = address.startsWith('[')
      // A listener bound only to another interface is not reachable as localhost.
      if (!['*', '0.0.0.0', '127.0.0.1', 'localhost'].includes(address) && !address.startsWith('[::')) continue
      const key = `${pid}:${port}`
      const known = sockets.get(key)
      // Prefer IPv4 when both are open; it is what most dev servers expect.
      if (!known || (known.host === '::1' && !ipv6))
        sockets.set(key, { pid, port, process, host: ipv6 && address !== '[::]' ? '::1' : '127.0.0.1' })
    }
  }
  return [...sockets.values()]
}

/** `RAMU_OWNER` from one process's environment as `ps -Eww` prints it after the command, or from `/proc/<pid>/environ`. */
export function ownerFromEnvironment(text: string): string | null {
  return new RegExp(`(?:^|[\\s\\0])${OWNER_ENV}=([\\w:-]+)`).exec(text)?.[1] ?? null
}

/**
 * Which root owns each process: roots claim their descendants, nested roots first, so a command an agent started keeps
 * its own owner. Shared with Resources so a process is never counted under two owners.
 */
export function processOwners(rows: ProcessRow[], roots: ProcessRoot[]): Map<number, ProcessRoot> {
  const children = new Map<number, ProcessRow[]>()
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row])
  const depth = (pid: number) => {
    let level = 0
    for (let row = byPid.get(pid); row && level < 64; row = byPid.get(row.ppid)) level++
    return level
  }
  const owners = new Map<number, ProcessRoot>()
  for (const root of [...roots].sort((a, b) => depth(b.pid) - depth(a.pid))) {
    const stack = byPid.has(root.pid) ? [byPid.get(root.pid)!] : []
    while (stack.length) {
      const row = stack.pop()!
      if (owners.has(row.pid)) continue
      owners.set(row.pid, root)
      stack.push(...(children.get(row.pid) ?? []))
    }
  }
  return owners
}

/**
 * Gives each listening socket to the thread whose work started it. A process still under its owner is found through the
 * process tree; one that detached (`nohup`, `&`, a daemon) is found by the owner its environment names. An agent's own
 * process is left out: its internal ports are not servers the person started.
 */
export function attributeServers(
  sockets: ListeningSocket[],
  owners: ReadonlyMap<number, ProcessRoot>,
  roots: ProcessRoot[],
  environmentOwners: ReadonlyMap<number, string>,
  ended: ReadonlyMap<string, ProcessRoot> = new Map(),
  daemons: ReadonlyMap<number, string> = new Map(),
): Omit<ThreadServer, 'web'>[] {
  const rootPids = new Set(roots.map((root) => root.pid))
  const byItem = new Map([...ended, ...roots.map((root) => [root.item.id, root] as const)])
  const servers: Omit<ThreadServer, 'web'>[] = []
  for (const socket of sockets) {
    if (rootPids.has(socket.pid) && owners.get(socket.pid)?.item.kind === 'agent') continue
    const tree = owners.get(socket.pid)
    const named = environmentOwners.get(socket.pid)
    const owner = tree ?? (named ? byItem.get(named) : undefined)
    if (!owner) continue
    servers.push({
      port: socket.port,
      pid: socket.pid,
      host: socket.host,
      process: socket.process,
      taskId: owner.taskId,
      owner: owner.item,
      orphaned: !tree && !roots.some((root) => root.item.id === owner.item.id),
      ...(daemons.has(socket.pid) ? { daemon: daemons.get(socket.pid) } : {}),
    })
  }
  return servers.sort((a, b) => a.port - b.port)
}

/** The address a person types for it; IPv6-only servers need brackets. */
export const serverUrl = (server: Pick<ThreadServer, 'port' | 'host'>) =>
  server.host === '::1' ? `http://[::1]:${server.port}` : `http://localhost:${server.port}`

/** Linux without `lsof`: `ss -Hltnp` lines such as `LISTEN 0 511 *:5173 *:* users:(("node",pid=12,fd=21))`. */
export function parseSs(text: string): ListeningSocket[] {
  const lines: string[] = []
  for (const line of text.split('\n')) {
    const local = line.trim().split(/\s+/)[3]
    for (const user of line.matchAll(/\("([^"]+)",pid=(\d+)/g))
      if (local) lines.push(`p${user[2]}`, `c${user[1]}`, `n${local.replace(/%[^:\]]+/, '')}`)
  }
  return parseListening(lines.join('\n'))
}
