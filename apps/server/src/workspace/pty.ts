// PTY-backed terminals. Each terminal is started in a binding's cwd and keeps that reference.
import { randomUUID } from 'node:crypto'
import * as nodePty from 'node-pty'

export interface TerminalInfo {
  id: string
  taskId: string
  repoId: string | null
  cwd: string
  exited: boolean
  /** Set for a persistent command Ramu launched for a thread; ordinary shells omit it. */
  background?: true
}

export type BackgroundTerminalState = 'running' | 'stopping' | 'exited' | 'failed'

/** Server-owned metadata for one Ramu-launched persistent command. Never carries environment or credentials. */
export interface BackgroundTerminalInfo {
  id: string
  taskId: string
  repoId: string | null
  cwd: string
  command: string
  state: BackgroundTerminalState
  startedAt: number
  endedAt: number | null
  /** Exit code once ended; null while running. */
  exitCode: number | null
  cursor: number
  capabilities: { inspect: true; stop: true; forceStop: boolean; input: true }
}

interface BackgroundMeta {
  command: string
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  stopRequested: boolean
  forced: boolean
}

interface Entry extends TerminalInfo {
  pty: nodePty.IPty
  shell: string
  output: string
  cursor: number
  bg?: BackgroundMeta
}

const MAX_COMMAND = 4000

export class TerminalService {
  private readonly terms = new Map<string, Entry>()

  constructor(
    private readonly onData: (id: string, data: string, cursor: number) => void,
    private readonly onExit: (id: string, code: number) => void,
    /** A shell was opened, ended or closed in this workspace; every device re-reads the list. */
    private readonly onChange: (taskId: string) => void = () => {},
  ) {}

  open(taskId: string, repoId: string | null, cwd: string, cols = 80, rows = 24): TerminalInfo {
    return info(this.start(taskId, repoId, cwd, cols, rows))
  }

  private start(
    taskId: string,
    repoId: string | null,
    cwd: string,
    cols: number,
    rows: number,
    command?: string,
  ): Entry {
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
    const win = process.platform === 'win32'
    const args = command ? (win ? ['-Command', command] : ['-lc', command]) : win ? [] : ['-l']
    const pty = nodePty.spawn(shell, args, {
      name: 'xterm-256color',
      cwd,
      cols,
      rows,
      env: { ...process.env, TERM_PROGRAM: 'Ramu' } as Record<string, string>,
    })
    const entry: Entry = { id: randomUUID(), taskId, repoId, cwd, exited: false, pty, shell, output: '', cursor: 0 }
    if (command) {
      entry.background = true
      entry.bg = { command, startedAt: Date.now(), endedAt: null, exitCode: null, stopRequested: false, forced: false }
    }
    this.terms.set(entry.id, entry)
    pty.onData((d) => {
      entry.cursor += d.length
      entry.output = (entry.output + d).slice(-256_000)
      this.onData(entry.id, d, entry.cursor)
    })
    pty.onExit(({ exitCode }) => {
      entry.exited = true
      if (entry.bg) {
        entry.bg.endedAt = Date.now()
        entry.bg.exitCode = exitCode
      }
      this.onExit(entry.id, exitCode)
      this.onChange(entry.taskId)
    })
    queueMicrotask(() => this.onChange(taskId))
    return entry
  }

  /**
   * Starts a persistent command for a thread. Launching the same command in the same folder while it still runs returns
   * the running one, so a retried request never starts a second server.
   */
  launchBackground(taskId: string, repoId: string | null, cwd: string, command: string): BackgroundTerminalInfo {
    const text = command.trim()
    if (!text || text.length > MAX_COMMAND) throw new Error('Command must be 1 to 4000 characters.')
    const running = [...this.terms.values()].find(
      (e) => e.bg && !e.exited && e.taskId === taskId && e.repoId === repoId && e.cwd === cwd && e.bg.command === text,
    )
    if (running) return backgroundInfo(running)
    return backgroundInfo(this.start(taskId, repoId, cwd, 80, 24, text))
  }

  /** The thread's persistent commands, running first then newest first. */
  listBackground(taskId: string): BackgroundTerminalInfo[] {
    return [...this.terms.values()]
      .filter((e) => e.bg && e.taskId === taskId)
      .map(backgroundInfo)
      .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.startedAt - a.startedAt)
  }

  /** Rejects any id that is not a persistent command owned by this thread. */
  inspectBackground(taskId: string, id: string): BackgroundTerminalInfo & { output: string } {
    const e = this.ownedBackground(taskId, id)
    return { ...backgroundInfo(e), output: e.output }
  }

  /**
   * Asks the command's own process group to end (SIGTERM; SIGKILL when `force`). Safe to repeat and safe after the
   * command already ended; the final output and exit outcome stay readable.
   */
  stopBackground(taskId: string, id: string, force = false): BackgroundTerminalInfo {
    const e = this.ownedBackground(taskId, id)
    const bg = e.bg!
    if (e.exited || bg.forced || (bg.stopRequested && !force)) return backgroundInfo(e)
    bg.stopRequested = true
    bg.forced = force
    this.signalGroup(e, force ? 'SIGKILL' : 'SIGTERM')
    this.onChange(e.taskId)
    return backgroundInfo(e)
  }

  /** The pty child leads its own session, so its pid names the group holding every descendant. */
  private signalGroup(e: Entry, signal: 'SIGTERM' | 'SIGKILL'): void {
    try {
      if (process.platform === 'win32') e.pty.kill()
      else process.kill(-e.pty.pid, signal)
    } catch {
      try {
        e.pty.kill(signal)
      } catch {
        // Already gone; the exit event settles the state.
      }
    }
  }

  private ownedBackground(taskId: string, id: string): Entry {
    const e = this.terms.get(id)
    if (!e?.bg || e.taskId !== taskId) throw new Error(`Unknown background terminal ${id}`)
    return e
  }

  list(taskId: string): TerminalInfo[] {
    return [...this.terms.values()].filter((entry) => entry.taskId === taskId).map(info)
  }

  snapshot(id: string): { output: string; cursor: number; exited: boolean } {
    const entry = this.require(id)
    return { output: entry.output, cursor: entry.cursor, exited: entry.exited }
  }

  get(id: string): TerminalInfo | undefined {
    const e = this.terms.get(id)
    return e && info(e)
  }

  write(id: string, data: string): void {
    this.require(id).pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.require(id)
    if (!e.exited) e.pty.resize(cols, rows)
  }

  close(id: string): void {
    const e = this.terms.get(id)
    if (!e) return
    // Closing a view of a running persistent command only detaches it; stopping is its own action.
    if (e.bg && !e.exited) return
    this.destroy(id)
  }

  /** True while something other than the login shell itself holds the terminal's foreground. */
  busy(id: string): boolean {
    const e = this.terms.get(id)
    if (!e || e.exited) return false
    if (e.bg) return true
    const name = (value: string) =>
      value
        .split(/[\\/]/)
        .pop()!
        .replace(/^-/, '')
        .replace(/\.exe$/i, '')
    try {
      return name(e.pty.process) !== name(e.shell)
    } catch {
      return false
    }
  }

  closeTask(taskId: string): void {
    for (const [id, e] of this.terms) if (e.taskId === taskId) this.destroy(id)
  }

  closeAll(): void {
    for (const id of [...this.terms.keys()]) this.destroy(id)
  }

  /** Ends and forgets a terminal, persistent commands included (thread removal, shutdown). */
  private destroy(id: string): void {
    const e = this.terms.get(id)
    if (!e) return
    if (!e.exited) {
      if (e.bg) this.signalGroup(e, 'SIGKILL')
      else e.pty.kill()
    }
    this.terms.delete(id)
    this.onChange(e.taskId)
  }

  private require(id: string): Entry {
    const e = this.terms.get(id)
    if (!e) throw new Error(`Unknown terminal ${id}`)
    return e
  }
}

function info({ id, taskId, repoId, cwd, exited, background }: Entry): TerminalInfo {
  return { id, taskId, repoId, cwd, exited, ...(background ? { background } : {}) }
}

const isLive = (b: BackgroundTerminalInfo) => b.state === 'running' || b.state === 'stopping'

function backgroundInfo(e: Entry): BackgroundTerminalInfo {
  const bg = e.bg!
  const state: BackgroundTerminalState = !e.exited
    ? bg.stopRequested
      ? 'stopping'
      : 'running'
    : bg.stopRequested || bg.exitCode === 0
      ? 'exited'
      : 'failed'
  return {
    id: e.id,
    taskId: e.taskId,
    repoId: e.repoId,
    cwd: e.cwd,
    command: bg.command,
    state,
    startedAt: bg.startedAt,
    endedAt: bg.endedAt,
    exitCode: bg.exitCode,
    cursor: e.cursor,
    capabilities: { inspect: true, stop: true, forceStop: process.platform !== 'win32', input: true },
  }
}
