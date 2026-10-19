import { realpathSync, watch, type FSWatcher } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { loadProjectConfig } from './projectConfig'

interface WatchedProject {
  root: string
  signature: string
  rootWatch?: FSWatcher
  nestedWatch?: FSWatcher
  nestedPath?: string
  timer?: NodeJS.Timeout
}

/** Narrow configuration watches, shared by a project's clients and released when the project is removed. */
export class ProjectConfigWatchers {
  private projects = new Map<string, WatchedProject>()
  constructor(private changed: () => void) {}

  ensure(projectId: string, root: string | null) {
    let canonical: string
    try {
      canonical = root ? realpathSync(root) : ''
    } catch {
      canonical = ''
    }
    const previous = this.projects.get(projectId)
    if (!canonical || previous?.root !== canonical) this.remove(projectId)
    if (!canonical) return
    const entry = this.projects.get(projectId) ?? {
      root: canonical,
      signature: JSON.stringify(loadProjectConfig(canonical)),
    }
    this.projects.set(projectId, entry)
    const changed = () => {
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        if (this.projects.get(projectId) !== entry) return
        this.watchNested(entry, changed)
        const signature = JSON.stringify(loadProjectConfig(entry.root))
        if (entry.signature === signature) return
        entry.signature = signature
        this.changed()
      }, 100)
      entry.timer.unref()
    }
    if (!entry.rootWatch) {
      try {
        entry.rootWatch = watch(canonical, { persistent: false }, (_event, name) => {
          if (name?.toString() === '.ramu') {
            entry.nestedWatch?.close()
            entry.nestedWatch = undefined
            entry.nestedPath = undefined
          }
          if (name === null || ['ramu.json', '.ramu', basename(canonical)].includes(name.toString())) changed()
        })
        entry.rootWatch.on('error', () => {
          entry.rootWatch?.close()
          entry.rootWatch = undefined
          changed()
        })
        // Close the read/subscribe gap even when the platform coalesces the first file event.
        changed()
      } catch {
        /* Reconnect or the next configuration read retries unavailable folders. */
      }
    }
    this.watchNested(entry, changed)
  }

  private watchNested(entry: WatchedProject, changed: () => void) {
    let target: string | undefined
    try {
      const path = realpathSync(join(entry.root, '.ramu'))
      const rel = relative(entry.root, path)
      if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) target = path
    } catch {
      /* The root watch notices creation of .ramu. */
    }
    if (entry.nestedPath !== target) {
      entry.nestedWatch?.close()
      entry.nestedWatch = undefined
      entry.nestedPath = target
    }
    if (!target || entry.nestedWatch) return
    try {
      entry.nestedWatch = watch(target, { persistent: false }, (_event, name) => {
        if (name === null || name.toString() === 'config.json') changed()
      })
      entry.nestedWatch.on('error', () => {
        entry.nestedWatch?.close()
        entry.nestedWatch = undefined
        changed()
      })
    } catch {
      /* The next read retries a replaced directory. */
    }
  }

  retain(projectIds: string[]) {
    const keep = new Set(projectIds)
    for (const id of this.projects.keys()) if (!keep.has(id)) this.remove(id)
  }

  private remove(id: string) {
    const entry = this.projects.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    entry.rootWatch?.close()
    entry.nestedWatch?.close()
    this.projects.delete(id)
  }

  close() {
    for (const id of this.projects.keys()) this.remove(id)
  }
}
