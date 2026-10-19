import { readlinkSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { loadProjectConfig } from './projectConfig'

interface DirectoryWatch {
  watcher: FSWatcher
  identity: string
  names: Set<string>
}
interface WatchedProject {
  root: string
  signature: string
  watches: Map<string, DirectoryWatch>
  timer?: NodeJS.Timeout
}

/** Narrow configuration watches, shared by a project's clients and released when the project is removed. */
export class ProjectConfigWatchers {
  private projects = new Map<string, WatchedProject>()
  constructor(private changed: () => void) {}

  ensure(projectId: string, root: string | null) {
    const path = root ? resolve(root) : ''
    const previous = this.projects.get(projectId)
    if (previous && previous.root !== path) this.remove(projectId)
    if (!path) return
    const entry = this.projects.get(projectId) ?? {
      root: path,
      signature: JSON.stringify(loadProjectConfig(path)),
      watches: new Map<string, DirectoryWatch>(),
    }
    this.projects.set(projectId, entry)
    this.refresh(projectId, entry)
    // Close the read/subscribe gap, including after an unavailable directory returns.
    this.schedule(projectId, entry)
  }

  private schedule(projectId: string, entry: WatchedProject) {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      if (this.projects.get(projectId) !== entry) return
      this.refresh(projectId, entry)
      const signature = JSON.stringify(loadProjectConfig(entry.root))
      if (entry.signature === signature) return
      entry.signature = signature
      this.changed()
    }, 100)
    entry.timer.unref()
  }

  private refresh(projectId: string, entry: WatchedProject) {
    const wanted = new Map<string, Set<string>>()
    const add = (directory: string, name: string) => {
      const names = wanted.get(directory) ?? new Set<string>()
      names.add(name)
      wanted.set(directory, names)
    }
    // Watching the root's inode cannot observe replacement of the registered path.
    add(dirname(entry.root), basename(entry.root))
    let root: string | undefined
    try {
      root = realpathSync(entry.root)
      add(dirname(root), basename(root))
      add(root, 'ramu.json')
      add(root, '.ramu')
    } catch {
      // The parent watch notices when the project is recreated.
    }
    if (root) {
      const base = root
      const within = (path: string) => {
        const rel = relative(base, path)
        return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
      }
      const addTarget = (path: string) => {
        if (!within(path)) return
        // Rebind after atomic replacement of a target or any of its directories.
        while (path !== base) {
          add(dirname(path), basename(path))
          path = dirname(path)
        }
      }
      for (const source of ['ramu.json', '.ramu', '.ramu/config.json']) {
        try {
          const target = realpathSync(join(base, source))
          addTarget(target)
          if (source === '.ramu' && within(target)) add(target, 'config.json')
        } catch {
          // Keep a broken internal link's target directory watched so recreating the
          // file restores configuration without requiring a client read.
          try {
            const link = join(realpathSync(dirname(join(base, source))), basename(source))
            const target = resolve(dirname(link), readlinkSync(link))
            let ancestor = dirname(target)
            while (within(ancestor)) {
              try {
                const canonical = realpathSync(ancestor)
                if (within(canonical)) addTarget(join(canonical, relative(ancestor, target)))
                break
              } catch {
                if (ancestor === base) break
                ancestor = dirname(ancestor)
              }
            }
          } catch {
            // Existing ancestors observe creation; outside-project targets are never watched.
          }
        }
      }
    }
    for (const [path, current] of entry.watches) {
      let identity: string | undefined
      try {
        const stat = statSync(path)
        identity = `${stat.dev}:${stat.ino}`
      } catch {}
      if (!wanted.has(path) || current.identity !== identity) {
        current.watcher.close()
        entry.watches.delete(path)
      }
    }
    for (const [path, names] of wanted) {
      const current = entry.watches.get(path)
      if (current) {
        current.names = names
        continue
      }
      try {
        const stat = statSync(path)
        const watcher = watch(path, { persistent: false }, (_event, name) => {
          const active = entry.watches.get(path)
          if (name === null || active?.names.has(name.toString())) this.schedule(projectId, entry)
        })
        const record = { watcher, identity: `${stat.dev}:${stat.ino}`, names }
        entry.watches.set(path, record)
        watcher.on('error', () => {
          watcher.close()
          if (entry.watches.get(path) !== record) return
          entry.watches.delete(path)
          this.schedule(projectId, entry)
        })
      } catch {
        // Ancestor events or a later configuration read retry unavailable directories.
      }
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
    for (const { watcher } of entry.watches.values()) watcher.close()
    this.projects.delete(id)
  }

  close() {
    for (const id of this.projects.keys()) this.remove(id)
  }
}
