import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import {
  folderName,
  isSystemFolder,
  type HostFolder,
  type HostFolderListing,
  type HostPlace,
} from '@ramu/shared/workspace/hostFolders'
import { spawn, type ChildProcess } from 'node:child_process'
import { hostDrives, withDeadline } from './hostDrives'

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

/** The most folders one listing offers, and how many are looked at at once. */
const MAX_LISTED = 2000
const LIST_CONCURRENCY = 16
/** A folder that takes longer than this to look at is left out of its listing. */
const ENTRY_MS = 1500
/** How many project folders the picker's places offer. */
const MAX_PROJECT_PLACES = 8

/** `~` and `~/…` are the host's home folder, so a typed path can start there. */
const expandHome = (path: string) => (/^~(?=$|[\\/])/.test(path) ? homedir() + path.slice(1) : path)

/** A failed look at a folder, said so a person knows what to change. */
const unreadable = (path: string, error: unknown): Error => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return new Error(`There is no folder at ${path} on the host`)
  if (code === 'EACCES' || code === 'EPERM') return new Error(`The host can't open ${path}. Its user has no access.`)
  return new Error(`The host can't open ${path}`, { cause: error })
}

async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await run(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

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
    private readonly entryMs = ENTRY_MS,
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
  /**
   * `RAMU_BROWSE_ROOTS` holds the folder calls to those folders. Without it they reach every folder the host's user can
   * read, as a native folder dialog on the host would; the device asking is already an owner of this host.
   */
  private async confinement(): Promise<string[] | null> {
    const configured = process.env.RAMU_BROWSE_ROOTS?.split(delimiter).filter(Boolean)
    return configured ? [...new Set(await Promise.all(configured.map((root) => realpath(root))))] : null
  }
  private async check(path: string, confine?: string[] | null) {
    const wanted = expandHome(path)
    if (!isAbsolute(wanted) || wanted.includes('\0')) throw new Error('Choose an absolute host folder path')
    const actual = await realpath(wanted).catch((error: unknown) => {
      throw unreadable(wanted, error)
    })
    const roots = confine === undefined ? await this.confinement() : confine
    if (roots && !roots.some((root) => within(root, actual)))
      throw new Error('This folder is outside the host browse roots')
    if (!(await stat(actual)).isDirectory()) throw new Error(`${wanted} is a file, not a folder`)
    return actual
  }
  /**
   * Where the picker starts: the home folder, the computer's root and each mounted drive, then the project folders.
   * Each is looked at with a deadline, so an absent network volume cannot hold the list up; one that is gone, slow
   * or outside the browse roots is left out, and a place reached twice is listed once.
   */
  async places(): Promise<HostPlace[]> {
    const confine = await this.confinement()
    const home = homedir()
    const candidates: HostPlace[] = [
      { kind: 'home', name: folderName(home), path: home },
      ...(await hostDrives()),
      ...this.projectRoots()
        .slice(0, MAX_PROJECT_PLACES)
        .map((path): HostPlace => ({ kind: 'project', name: folderName(path), path })),
    ]
    const checked = await Promise.all(
      candidates.map((place) =>
        withDeadline(this.check(place.path, confine), this.entryMs).then(
          (path) => ({ ...place, path }),
          () => null,
        ),
      ),
    )
    const seen = new Set<string>()
    return checked.filter((place): place is HostPlace => {
      if (!place || seen.has(place.path)) return false
      seen.add(place.path)
      return true
    })
  }
  async list(path: string): Promise<HostFolderListing> {
    const roots = await this.confinement()
    const actual = await this.check(path, roots)
    const entries = (
      await readdir(actual, { withFileTypes: true }).catch((error: unknown) => {
        throw unreadable(actual, error)
      })
    )
      // Hidden folders (.git, .cache, .config) are never where a project starts, and they crowd the list.
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
      .slice(0, MAX_LISTED)
    // A home folder holds protected, network and cloud-synced folders that can stall a lookup; checking them
    // together, each with a deadline, keeps the list answering at once instead of after the slowest one.
    const folders: HostFolder[] = []
    await eachLimited(entries, LIST_CONCURRENCY, async (entry) => {
      const candidate = join(actual, entry.name)
      const repo = await withDeadline(
        this.check(candidate, roots).then(() => isRepository(candidate)),
        this.entryMs,
      ).catch(() => null)
      // Inaccessible, slow and symlink-escaping folders are not offered.
      if (repo !== null) folders.push({ name: entry.name, path: candidate, repo })
    })
    const up = dirname(actual)
    return {
      path: actual,
      parent: up === actual || (roots && !roots.some((root) => within(root, up))) ? null : up,
      repo: await isRepository(actual),
      system: isSystemFolder(actual, process.platform),
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
