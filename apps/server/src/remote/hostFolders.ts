import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import type { HostFolder, HostFolderListing } from '@ramu/shared/workspace/hostFolders'
import { spawn, type ChildProcess } from 'node:child_process'

/** A Git checkout keeps `.git` as a folder, or as a file in a linked worktree or submodule. */
const isRepository = (path: string) =>
  stat(join(path, '.git')).then(
    () => true,
    () => false,
  )

const within = (root: string, path: string) => {
  const rel = relative(root, path)
  return !rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
/** How far a running clone has got, as Git reports it. `percent` is null until Git says. */
export interface CloneProgress {
  phase: string
  percent: number | null
  running: boolean
}
/** A client-chosen id for one clone, so its progress can be read and it can be cancelled. */
export const CLONE_ID = /^[A-Za-z0-9_-]{8,64}$/
const PROGRESS =
  /(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files)[^:]*:\s+(\d+)%/
/** A clone that stops reporting for this long is abandoned; a slow, steady one is not. */
const CLONE_IDLE_MS = 120_000

interface RunningClone {
  progress: CloneProgress
  cancel(): void
}
export type GitSpawner = (args: string[]) => ChildProcess

export class HostFolders {
  private readonly clones = new Map<string, RunningClone>()
  constructor(
    private projectRoots: () => string[],
    private readonly spawnGit: GitSpawner = (args) =>
      spawn('git', args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'ignore', 'pipe'] }),
    private readonly idleMs = CLONE_IDLE_MS,
  ) {}
  cloneProgress(cloneId: string): CloneProgress | null {
    return this.clones.get(cloneId)?.progress ?? null
  }
  /** Stops a running clone and removes the folder it was filling. False when no such clone is running. */
  cancelClone(cloneId: string): boolean {
    const running = this.clones.get(cloneId)
    if (!running) return false
    running.cancel()
    return true
  }
  async roots(): Promise<string[]> {
    const configured = process.env.RAMU_BROWSE_ROOTS?.split(delimiter).filter(Boolean)
    const roots = configured ?? [homedir(), ...this.projectRoots()]
    return [...new Set(await Promise.all(roots.map((root) => realpath(root))))]
  }
  private async check(path: string) {
    if (!isAbsolute(path) || path.includes('\0')) throw new Error('Choose an absolute host folder path')
    const actual = await realpath(path)
    if (!(await this.roots()).some((root) => within(root, actual)))
      throw new Error('This folder is outside the host browse roots')
    if (!(await stat(actual)).isDirectory()) throw new Error('Not a host folder')
    return actual
  }
  async list(path: string): Promise<HostFolderListing> {
    const actual = await this.check(path)
    const roots = await this.roots()
    const entries = await readdir(actual, { withFileTypes: true })
    const folders: HostFolder[] = []
    for (const entry of entries.slice(0, 2000)) {
      // Hidden folders (.git, .cache, .config) are never where a project starts, and they crowd the list.
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.')) continue
      const candidate = join(actual, entry.name)
      try {
        await this.check(candidate)
        folders.push({ name: entry.name, path: candidate, repo: await isRepository(candidate) })
      } catch {
        /* inaccessible folders and symlink escapes are not offered */
      }
    }
    return {
      path: actual,
      parent: roots.some((root) => within(root, dirname(actual))) ? dirname(actual) : null,
      repo: await isRepository(actual),
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
    }
  }
  async create(parent: string, name: string) {
    if (!name.trim() || name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 200)
      throw new Error('Use a single folder name')
    const root = await this.check(parent)
    const path = join(root, name.trim())
    await mkdir(path)
    return this.check(path)
  }
  async inspect(path: string) {
    return this.check(path)
  }
  async clone(parent: string, name: string, url: string, cloneId?: string) {
    if (!/^(https?:\/\/|ssh:\/\/|git@)/.test(url) || /[\r\n\0]/.test(url))
      throw new Error('Use an HTTPS or SSH Git repository URL')
    if (cloneId !== undefined && (!CLONE_ID.test(cloneId) || this.clones.has(cloneId)))
      throw new Error('That clone is already running')
    // Do not accept embedded HTTPS passwords, which would persist in the Git remote.
    if (/^https?:/.test(url)) {
      const parsed = new URL(url)
      if (parsed.password || parsed.username)
        throw new Error('Use credentials configured on the host instead of embedding them in a URL')
    }
    const path = await this.create(parent, name)
    const child = this.spawnGit(['clone', '--progress', '--', url, path])
    const progress: CloneProgress = { phase: 'Starting', percent: null, running: true }
    let cancelled = false
    let idle: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      clearTimeout(idle)
      if (cloneId) this.clones.delete(cloneId)
      progress.running = false
    }
    const watch = () => {
      clearTimeout(idle)
      idle = setTimeout(() => child.kill('SIGTERM'), this.idleMs)
    }
    if (cloneId)
      this.clones.set(cloneId, {
        progress,
        cancel: () => {
          cancelled = true
          child.kill('SIGTERM')
        },
      })
    watch()
    let buffer = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      watch()
      // Git redraws a progress line with carriage returns; read the latest complete one.
      buffer = (buffer + chunk.toString()).slice(-4000)
      const lines = buffer.split(/[\r\n]+/)
      for (const line of lines.slice(0, -1).reverse()) {
        const match = PROGRESS.exec(line)
        if (match) {
          progress.phase = match[1]!
          progress.percent = Number(match[2])
          break
        }
      }
    })
    const outcome = await new Promise<'done' | 'failed'>((resolve) => {
      child.once('error', () => resolve('failed'))
      child.once('close', (code) => resolve(code === 0 ? 'done' : 'failed'))
    })
    stop()
    if (cancelled) {
      // A deliberate cancel leaves nothing behind; a failure keeps the folder for inspection.
      await rm(path, { recursive: true, force: true }).catch(() => {})
      throw new Error('Clone cancelled')
    }
    if (outcome === 'failed')
      throw new Error(
        'Clone failed. Check the URL and Git credentials on the host. The destination folder was kept for inspection.',
      )
    return path
  }
}
