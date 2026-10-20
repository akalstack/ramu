// PTY-backed terminals. Each terminal is started in a binding's cwd and keeps that reference.
import { randomUUID } from 'node:crypto'
import * as nodePty from 'node-pty'
import type { BackgroundTerminalHistory, BackgroundTerminalRecord } from './backgroundTerminalHistory'
import { removalCommands, type TaskRemovalReview } from '@ramu/shared/chat/taskRemoval'

import type { TerminalInfo, BackgroundTerminalInfo, BackgroundTerminalState } from '@ramu/shared/api'
export type { TerminalInfo, BackgroundTerminalInfo, BackgroundTerminalState } from '@ramu/shared/api'

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
  private readonly history = new Map<string, BackgroundTerminalRecord>()
  private readonly checkpoints = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly warned = new Set<string>()
  private readonly removing = new Set<string>()

  constructor(
    private readonly onData: (id: string, data: string, cursor: number) => void,
    private readonly onExit: (id: string, code: number) => void,
    /** A shell was opened, ended or closed in this workspace; every device re-reads the list. */
    private readonly onChange: (taskId: string) => void = () => {},
    private readonly storage?: BackgroundTerminalHistory,
  ) {
    for (const record of storage?.load() ?? []) this.history.set(record.id, record)
  }

  open(taskId: string, repoId: string | null, cwd: string, cols = 80, rows = 24): TerminalInfo {
    this.assertTaskAvailable(taskId)
    return info(this.start(taskId, repoId, cwd, cols, rows))
  }

  private start(
    taskId: string,
    repoId: string | null,
    cwd: string,
    cols: number,
    rows: number,
    command?: string,
    id = randomUUID(),
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
    const entry: Entry = { id, taskId, repoId, cwd, exited: false, pty, shell, output: '', cursor: 0 }
    if (command) {
      entry.background = true
      entry.bg = { command, startedAt: Date.now(), endedAt: null, exitCode: null, stopRequested: false, forced: false }
    }
    this.terms.set(entry.id, entry)
    pty.onData((d) => {
      entry.cursor += d.length
      entry.output = (entry.output + d).slice(-256_000)
      this.onData(entry.id, d, entry.cursor)
      if (entry.bg && this.terms.has(entry.id) && !this.checkpoints.has(entry.id)) {
        const timer = setTimeout(() => {
          this.checkpoints.delete(entry.id)
          this.checkpoint(entry)
        }, 1000)
        timer.unref()
        this.checkpoints.set(entry.id, timer)
      }
    })
    pty.onExit(({ exitCode }) => {
      entry.exited = true
      if (entry.bg) {
        entry.bg.endedAt = Date.now()
        entry.bg.exitCode = exitCode
        this.checkpoint(entry)
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
    this.assertTaskAvailable(taskId)
    const text = command.trim()
    if (!text || text.length > MAX_COMMAND) throw new Error('Command must be 1 to 4000 characters.')
    const running = [...this.terms.values()].find(
      (e) => e.bg && !e.exited && e.taskId === taskId && e.repoId === repoId && e.cwd === cwd && e.bg.command === text,
    )
    if (running) return backgroundInfo(running)
    const id = randomUUID()
    const prepared: BackgroundTerminalRecord = {
      id,
      taskId,
      repoId,
      cwd,
      command: text,
      state: 'unknown',
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      cursor: 0,
      output: '',
      capabilities: { inspect: true, stop: false, forceStop: false, input: false },
    }
    // Record intent before spawning. A storage failure must never leave an untracked command running.
    this.storage?.save(prepared)
    this.history.set(id, prepared)
    try {
      const entry = this.start(taskId, repoId, cwd, 80, 24, text, id)
      this.checkpoint(entry, true)
      return backgroundInfo(entry)
    } catch (error) {
      this.destroy(id, false)
      throw error
    }
  }

  /** The thread's persistent commands, running first then newest first. */
  listBackground(taskId: string): BackgroundTerminalInfo[] {
    const records = new Map(
      [...this.history.values()].filter((record) => record.taskId === taskId).map((record) => [record.id, record]),
    )
    for (const record of [...this.terms.values()].filter((e) => e.bg && e.taskId === taskId).map(backgroundInfo))
      records.set(record.id, { ...record, output: '' })
    return [...records.values()]
      .map(({ output: _output, ...record }) => record)
      .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.startedAt - a.startedAt)
  }

  /** Rejects any id that is not a persistent command owned by this thread. */
  inspectBackground(taskId: string, id: string): BackgroundTerminalInfo & { output: string } {
    const saved = this.history.get(id)
    if (!this.terms.has(id) && saved?.taskId === taskId) return { ...saved, capabilities: { ...saved.capabilities } }
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
    if (force && !bg.stopRequested) throw new Error('Request graceful stop before force stop.')
    if (force && process.platform === 'win32') throw new Error('Force stop is unavailable on this host.')
    bg.stopRequested = true
    bg.forced = force
    this.checkpoint(e)
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
    const records = new Map(
      [...this.history.values()]
        .filter((entry) => entry.taskId === taskId)
        .map((entry) => [entry.id, savedInfo(entry)]),
    )
    for (const entry of this.terms.values()) if (entry.taskId === taskId) records.set(entry.id, info(entry))
    return [...records.values()]
  }

  snapshot(id: string): { output: string; cursor: number; exited: boolean } {
    const saved = this.history.get(id)
    if (!this.terms.has(id) && saved) return { output: saved.output, cursor: saved.cursor, exited: true }
    const entry = this.require(id)
    return { output: entry.output, cursor: entry.cursor, exited: entry.exited }
  }

  get(id: string): TerminalInfo | undefined {
    const e = this.terms.get(id)
    return e ? info(e) : this.history.has(id) ? savedInfo(this.history.get(id)!) : undefined
  }

  write(id: string, data: string): void {
    const entry = this.require(id)
    if (entry.exited) throw new Error('This terminal has ended. Its output is read-only.')
    entry.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (!this.terms.has(id) && this.history.has(id)) return
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
    // Closing a persistent command's output only detaches the view; it cannot terminate that command.
    if (e.bg) return false
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

  closeTask(taskId: string, options: { keepHistory?: boolean } = {}): void {
    if (!options.keepHistory) this.storage?.removeTask(taskId)
    for (const [id, e] of this.terms) if (e.taskId === taskId) this.destroy(id, options.keepHistory ?? false)
    if (!options.keepHistory)
      for (const [id, record] of this.history) if (record.taskId === taskId) this.history.delete(id)
  }

  assertTaskAvailable(taskId: string): void {
    if (this.removing.has(taskId)) throw new Error('This thread is being deleted. Wait for deletion to finish.')
  }

  async withTaskRemoval<T>(taskIds: string[], action: () => Promise<T>): Promise<T> {
    for (const id of taskIds) this.assertTaskAvailable(id)
    taskIds.forEach((id) => this.removing.add(id))
    try {
      return await action()
    } finally {
      taskIds.forEach((id) => this.removing.delete(id))
    }
  }

  reviewRemoval(taskId: string, removeWorktrees: boolean, review?: TaskRemovalReview): void {
    const commands = removalCommands(this.listBackground(taskId))
    if (commands.some((command) => !review?.backgroundIds.includes(command.id)))
      throw new Error(
        'Background commands changed or need review. Review the current commands before deleting this thread.',
      )
    if (commands.some((command) => command.state === 'unknown')) {
      if (removeWorktrees)
        throw new Error(
          'A background command has unknown status. Keep the worktree and verify the command on its host before removing files.',
        )
      if (!review?.forgetUnknown)
        throw new Error(
          'Unknown commands cannot be stopped. Review that deleting this thread will forget their saved records while keeping its files.',
        )
    }
  }

  async stopForRemoval(taskId: string, timeoutMs = 3000): Promise<void> {
    const commands = this.listBackground(taskId).filter(isLive)
    for (const command of commands) this.stopBackground(taskId, command.id)
    const deadline = Date.now() + timeoutMs
    while (commands.some((command) => this.terms.get(command.id)?.exited === false)) {
      if (Date.now() >= deadline)
        throw new Error(
          'Background commands are still stopping. Open Background terminals and use Force stop if available, then try deleting again.',
        )
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  closeAll(): void {
    for (const id of [...this.terms.keys()]) this.destroy(id)
  }

  /** Ends and forgets a terminal, persistent commands included (thread removal, shutdown). */
  private destroy(id: string, preserve = true): void {
    const e = this.terms.get(id)
    if (!e) return
    if (preserve) this.checkpoint(e)
    clearTimeout(this.checkpoints.get(id))
    this.checkpoints.delete(id)
    this.terms.delete(id)
    if (!e.exited) {
      if (e.bg) this.signalGroup(e, 'SIGKILL')
      else e.pty.kill()
    }
    const saved = this.history.get(id)
    if (preserve && saved)
      this.history.set(id, {
        ...backgroundInfo(e),
        output: e.output.slice(-64_000),
        state: e.exited ? backgroundInfo(e).state : 'unknown',
        capabilities: { inspect: true, stop: false, forceStop: false, input: false },
      })
    this.onChange(e.taskId)
  }

  private require(id: string): Entry {
    const e = this.terms.get(id)
    if (!e) throw new Error(`Unknown terminal ${id}`)
    return e
  }

  private checkpoint(entry: Entry, strict = false): void {
    if (!entry.bg || !this.terms.has(entry.id)) return
    clearTimeout(this.checkpoints.get(entry.id))
    this.checkpoints.delete(entry.id)
    const record = { ...backgroundInfo(entry), output: entry.output.slice(-64_000) }
    try {
      this.storage?.save(record)
      this.history.set(entry.id, record)
      const ordered = [...this.history.values()]
        .filter((saved) => saved.taskId === entry.taskId)
        .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
      for (const old of ordered.slice(100))
        if (old.state === 'exited' || old.state === 'failed') {
          this.history.delete(old.id)
          this.terms.delete(old.id)
        }
      this.warned.delete(entry.id)
    } catch (error) {
      if (strict) throw error
      if (!this.warned.has(entry.id)) console.warn('Could not checkpoint background terminal history.', error)
      this.warned.add(entry.id)
    }
  }
}

function savedInfo(record: BackgroundTerminalRecord): TerminalInfo {
  return {
    id: record.id,
    taskId: record.taskId,
    repoId: record.repoId,
    cwd: record.cwd,
    exited: true,
    background: true,
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
    capabilities: {
      inspect: true,
      stop: !e.exited,
      forceStop: !e.exited && process.platform !== 'win32',
      input: !e.exited,
    },
  }
}
