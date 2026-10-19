import { watch, type FSWatcher } from 'node:fs'
import { ProjectConfigWatchers } from '../workspace/projectConfigWatchers'

/**
 * One recursive watcher per canonical checkout. Tasks lease a checkout; the watcher is shared by every task
 * leasing it and closed (with its pending notifications) when the last lease is released.
 */
export class FileWatchers {
  readonly projectConfigs: ProjectConfigWatchers
  private watchers = new Map<string, { watcher: FSWatcher; timers: Map<string, NodeJS.Timeout> }>()
  private leases = new Map<string, Set<string>>()
  constructor(private send: (channel: string, payload: unknown) => void) {
    this.projectConfigs = new ProjectConfigWatchers(() => send('workspace:changed', {}))
  }

  /** Number of open checkout watchers. */
  get size() {
    return this.watchers.size
  }

  /** Watches `cwd` on behalf of `owner` (a task id). Repeated calls by the same owner are idempotent. */
  ensure(cwd: string, owner = '') {
    const owners = this.leases.get(cwd) ?? new Set<string>()
    owners.add(owner)
    this.leases.set(cwd, owners)
    if (this.watchers.has(cwd)) return
    const timers = new Map<string, NodeJS.Timeout>()
    try {
      const watcher = watch(cwd, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const path = filename.toString().split('\\').join('/')
        // Inside .git only the index and HEAD matter (staging, commits, external branch switches).
        if (path.startsWith('.git/') && !['.git/index', '.git/HEAD'].includes(path)) return
        clearTimeout(timers.get(path))
        timers.set(
          path,
          setTimeout(() => {
            timers.delete(path)
            this.send('fs:changed', { cwd, path })
          }, 100),
        )
      })
      // A watched folder that disappears or becomes unreadable must not keep a dead entry alive.
      watcher.on('error', () => this.dispose(cwd))
      this.watchers.set(cwd, { watcher, timers })
    } catch {
      // Watching is best-effort; saves still refuse to overwrite changed files.
    }
  }

  /** Drops `owner`'s leases; checkouts nobody else leases stop being watched. */
  release(owner: string) {
    for (const [cwd, owners] of [...this.leases]) {
      if (!owners.delete(owner)) continue
      if (owners.size === 0) this.dispose(cwd)
    }
  }

  private dispose(cwd: string) {
    this.leases.delete(cwd)
    const entry = this.watchers.get(cwd)
    if (!entry) return
    this.watchers.delete(cwd)
    for (const timer of entry.timers.values()) clearTimeout(timer)
    entry.timers.clear()
    entry.watcher.close()
  }

  close() {
    this.projectConfigs.close()
    for (const cwd of [...this.watchers.keys()]) this.dispose(cwd)
    this.leases.clear()
  }
}
