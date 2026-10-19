import { watch, type FSWatcher } from 'node:fs'
import { ProjectConfigWatchers } from '../workspace/projectConfigWatchers'

/** One recursive watcher per canonical checkout; tasks sharing a checkout share it. */
export class FileWatchers {
  readonly projectConfigs: ProjectConfigWatchers
  private watchers = new Map<string, FSWatcher>()
  constructor(private send: (channel: string, payload: unknown) => void) {
    this.projectConfigs = new ProjectConfigWatchers(() => send('workspace:changed', {}))
  }

  ensure(cwd: string) {
    if (this.watchers.has(cwd)) return
    const timers = new Map<string, NodeJS.Timeout>()
    try {
      const w = watch(cwd, { recursive: true }, (_event, filename) => {
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
      this.watchers.set(cwd, w)
    } catch {
      // Watching is best-effort; saves still refuse to overwrite changed files.
    }
  }

  close() {
    this.projectConfigs.close()
    for (const watcher of this.watchers.values()) watcher.close()
  }
}
