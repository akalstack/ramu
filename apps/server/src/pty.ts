// PTY-backed terminals. Each terminal is started in a binding's cwd and keeps that reference.
import { randomUUID } from 'node:crypto'
import * as nodePty from 'node-pty'

export interface TerminalInfo {
  id: string
  taskId: string
  repoId: string | null
  cwd: string
  exited: boolean
}

interface Entry extends TerminalInfo {
  pty: nodePty.IPty
  shell: string
  output: string
  cursor: number
}

export class TerminalService {
  private readonly terms = new Map<string, Entry>()

  constructor(
    private readonly onData: (id: string, data: string, cursor: number) => void,
    private readonly onExit: (id: string, code: number) => void,
    /** A shell was opened, ended or closed in this workspace; every device re-reads the list. */
    private readonly onChange: (taskId: string) => void = () => {},
  ) {}

  open(taskId: string, repoId: string | null, cwd: string, cols = 80, rows = 24): TerminalInfo {
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
    const pty = nodePty.spawn(shell, process.platform === 'win32' ? [] : ['-l'], {
      name: 'xterm-256color',
      cwd,
      cols,
      rows,
      env: { ...process.env, TERM_PROGRAM: 'Ramu' } as Record<string, string>,
    })
    const entry: Entry = { id: randomUUID(), taskId, repoId, cwd, exited: false, pty, shell, output: '', cursor: 0 }
    this.terms.set(entry.id, entry)
    pty.onData((d) => {
      entry.cursor += d.length
      entry.output = (entry.output + d).slice(-256_000)
      this.onData(entry.id, d, entry.cursor)
    })
    pty.onExit(({ exitCode }) => {
      entry.exited = true
      this.onExit(entry.id, exitCode)
      this.onChange(entry.taskId)
    })
    queueMicrotask(() => this.onChange(taskId))
    return info(entry)
  }

  list(taskId: string): TerminalInfo[] {
    return [...this.terms.values()].filter(entry => entry.taskId === taskId).map(info)
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
    if (!e.exited) e.pty.kill()
    this.terms.delete(id)
    this.onChange(e.taskId)
  }

  /** True while something other than the login shell itself holds the terminal's foreground. */
  busy(id: string): boolean {
    const e = this.terms.get(id)
    if (!e || e.exited) return false
    const name = (value: string) => value.split(/[\\/]/).pop()!.replace(/^-/, '').replace(/\.exe$/i, '')
    try { return name(e.pty.process) !== name(e.shell) } catch { return false }
  }

  closeTask(taskId: string): void {
    for (const [id, e] of this.terms) if (e.taskId === taskId) this.close(id)
  }

  closeAll(): void {
    for (const id of [...this.terms.keys()]) this.close(id)
  }

  private require(id: string): Entry {
    const e = this.terms.get(id)
    if (!e) throw new Error(`Unknown terminal ${id}`)
    return e
  }
}

function info({ id, taskId, repoId, cwd, exited }: Entry): TerminalInfo {
  return { id, taskId, repoId, cwd, exited }
}
