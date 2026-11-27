import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { ProcessRoot } from '@ramu/shared/resources'
import {
  attributeServers,
  buildDaemon,
  ownerFromEnvironment,
  parseListening,
  parseSs,
  processOwners,
  serverUrl,
  type ListeningSocket,
  type ThreadServer,
} from '@ramu/shared/servers'
import { readProcesses } from './resources'

const run = promisify(execFile)
const FRESH_MS = 1500
const WEB_CACHE_MS = 15_000
const STOP_WAIT_MS = 3000

async function readListening(): Promise<ListeningSocket[]> {
  if (process.platform === 'win32') return []
  try {
    const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], {
      timeout: 3000,
      maxBuffer: 8_000_000,
    })
    return parseListening(stdout)
  } catch (error) {
    // lsof exits 1 when nothing is listening; a missing lsof on Linux falls back to ss.
    const output = (error as { stdout?: string }).stdout
    if (output) return parseListening(output)
    if (process.platform !== 'linux') return []
    const { stdout } = await run('ss', ['-Hltnp'], { timeout: 3000, maxBuffer: 8_000_000 }).catch(() => ({
      stdout: '',
    }))
    return parseSs(stdout)
  }
}

/**
 * The owner a detached process's environment names, and the build daemon its command line is. Only the few listening
 * processes outside every tree are read.
 */
async function readDetached(pids: number[]): Promise<{ owners: Map<number, string>; daemons: Map<number, string> }> {
  const owners = new Map<number, string>()
  const daemons = new Map<number, string>()
  const learn = (pid: number, text: string) => {
    const owner = ownerFromEnvironment(text)
    if (owner) owners.set(pid, owner)
    const daemon = buildDaemon(text)
    if (daemon) daemons.set(pid, daemon)
  }
  if (!pids.length) return { owners, daemons }
  if (process.platform === 'linux') {
    await Promise.all(
      pids.map(async (pid) => {
        const [environment, command] = await Promise.all([
          readFile(`/proc/${pid}/environ`, 'utf8').catch(() => ''),
          readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => ''),
        ])
        learn(pid, `${command.replaceAll('\0', ' ')}\0${environment}`)
      }),
    )
    return { owners, daemons }
  }
  if (process.platform !== 'darwin') return { owners, daemons }
  for (const pid of pids) {
    const { stdout } = await run('/bin/ps', ['-Eww', '-o', 'command=', '-p', String(pid)], { timeout: 2000 }).catch(
      () => ({ stdout: '' }),
    )
    learn(pid, stdout)
  }
  return { owners, daemons }
}

/** Statuses that say "not for a browser": the listener wants a credential or another protocol, so a tab shows nothing. */
const NOT_A_PAGE = new Set([401, 403, 407, 426])

/**
 * Whether a browser would get something there. A dev server may answer 404 at its root, so most statuses count; a
 * listener that asks for a credential or a protocol upgrade (an agent's own service, a debugger port, an API behind a
 * token) is not a page, and its row offers Stop without pretending it opens.
 */
export async function answersHttp(server: Pick<ThreadServer, 'port' | 'host'>): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl(server).replace('localhost', '127.0.0.1')}/`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(800),
    })
    return !NOT_A_PAGE.has(response.status)
  } catch {
    return false
  }
}

/**
 * The servers threads started, read on demand: `lsof` runs only while someone is looking. Owners that ended are kept
 * for the session, so a server that outlived its terminal still shows under the thread that started it.
 */
export class ServerService {
  private cached: { at: number; value: ThreadServer[] } | null = null
  private reading: Promise<ThreadServer[]> | null = null
  private readonly web = new Map<string, { at: number; web: boolean }>()
  private readonly ended = new Map<string, ProcessRoot>()

  constructor(
    private readonly roots: () => ProcessRoot[],
    private readonly sources = {
      listening: readListening,
      processes: readProcesses,
      detached: readDetached,
      answersHttp,
    },
  ) {}

  async list(taskId?: string): Promise<ThreadServer[]> {
    const all =
      this.cached && Date.now() - this.cached.at < FRESH_MS
        ? this.cached.value
        : await (this.reading ??= this.read().finally(() => {
            this.reading = null
          }))
    return taskId ? all.filter((server) => server.taskId === taskId) : all
  }

  /**
   * Stops one server a thread started: SIGTERM, then SIGKILL if it is still there after a moment. Only a process this
   * thread owns and that is listening on that port right now; never Ramu itself or an agent.
   */
  async stop(taskId: string, pid: number, port: number): Promise<void> {
    this.cached = null
    const server = (await this.list(taskId)).find((entry) => entry.pid === pid && entry.port === port)
    if (!server || pid === process.pid || this.roots().some((root) => root.pid === pid && root.item.kind === 'agent'))
      throw new Error('That server has already stopped, or it is not one this thread started.')
    process.kill(pid, 'SIGTERM')
    const deadline = Date.now() + STOP_WAIT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (!alive(pid)) break
    }
    if (alive(pid)) process.kill(pid, 'SIGKILL')
    this.cached = null
  }

  /**
   * Stops a thread's build daemons, which only speed up its next build; with `all`, every server the thread started, as
   * when it is marked done and gives back what it holds.
   */
  async stopLeftBehind(taskId: string, { all = false } = {}): Promise<number> {
    this.cached = null
    const servers = (await this.list(taskId)).filter((server) => all || server.daemon)
    // A daemon listens on several ports; each process is stopped once.
    const pids = [...new Map(servers.map((server) => [server.pid, server])).values()]
    let stopped = 0
    for (const server of pids)
      await this.stop(taskId, server.pid, server.port).then(
        () => stopped++,
        () => {},
      )
    return stopped
  }

  private async read(): Promise<ThreadServer[]> {
    const roots = this.roots()
    for (const root of roots) {
      this.ended.delete(root.item.id)
      this.ended.set(root.item.id, root)
    }
    // Owners are kept for servers that outlive them, the most recent few hundred.
    for (const id of [...this.ended.keys()].slice(0, Math.max(0, this.ended.size - 500))) this.ended.delete(id)
    const [sockets, rows] = await Promise.all([this.sources.listening(), this.sources.processes()])
    const owners = processOwners(rows, roots)
    const detached = [...new Set(sockets.map((socket) => socket.pid).filter((pid) => !owners.has(pid)))]
    const { owners: environment, daemons } = await this.sources.detached(detached)
    const found = attributeServers(sockets, owners, roots, environment, this.ended, daemons)
    const now = Date.now()
    const value = await Promise.all(
      found.map(async (server) => {
        const key = `${server.pid}:${server.port}`
        // A build daemon is never a page; it is not asked.
        if (server.daemon) return { ...server, web: false }
        let known = this.web.get(key)
        if (!known || now - known.at > WEB_CACHE_MS) {
          known = { at: now, web: await this.sources.answersHttp(server) }
          this.web.set(key, known)
        }
        return { ...server, web: known.web }
      }),
    )
    this.cached = { at: Date.now(), value }
    return value
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
