// Where each project lives, for picking its identity: its folders, its repositories' remotes, and the checkouts its
// threads work in (worktrees live outside the project folder). Remotes are read from Git in the background and kept, so
// the lookups an environment or a guard makes stay synchronous.
import { join, sep } from 'node:path'
import type { ProjectPlace } from '@ramu/shared/identities'
import { NO_PROJECT } from '@ramu/shared/types'
import { git } from '../workspace/git'
import type { Workspace } from '../workspace/workspace'

const REFRESH_MS = 60_000

export class ProjectPlaces {
  private remotes = new Map<string, string[]>()
  private refreshedAt = 0
  private refreshing: Promise<void> | null = null
  private folders: { at: number; entries: [string, string][] } | null = null

  constructor(
    private readonly workspace: Pick<Workspace, 'listProjects' | 'listRepositories' | 'listTasks' | 'listBindings'>,
    private readonly chatsRoot: string,
  ) {}

  /** Reads every repository's remotes again; callers never wait for it. */
  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      const next = new Map<string, string[]>()
      for (const project of this.workspace.listProjects())
        for (const repo of this.workspace.listRepositories(project.id)) {
          const output = await git(repo.root, ['config', '--get-regexp', '^remote\\..*\\.url$']).catch(() => '')
          next.set(
            repo.root,
            output
              .split('\n')
              .map((line) => line.split(/\s+/)[1] ?? '')
              .filter(Boolean),
          )
        }
      this.remotes = next
      this.refreshedAt = Date.now()
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  places(): ProjectPlace[] {
    if (Date.now() - this.refreshedAt > REFRESH_MS) void this.refresh().catch(() => {})
    return this.workspace
      .listProjects()
      .filter((project) => project.id !== NO_PROJECT)
      .map((project) => {
        const repos = this.workspace.listRepositories(project.id)
        return {
          id: project.id,
          folders: [...(project.root ? [project.root] : []), ...repos.map((repo) => repo.root)],
          remotes: repos.flatMap((repo) => this.remotes.get(repo.root) ?? []),
        }
      })
  }

  /** The project a working folder belongs to: a project or repository folder, or a thread's own checkout. */
  projectOf(cwd: string): string | null {
    if (!this.folders || Date.now() - this.folders.at > 5_000) {
      const entries: [string, string][] = []
      for (const place of this.places()) for (const folder of place.folders) entries.push([folder, place.id])
      for (const task of this.workspace.listTasks()) {
        if (task.projectId === NO_PROJECT) continue
        entries.push([join(this.chatsRoot, task.id), task.projectId])
        try {
          for (const binding of this.workspace.listBindings(task.id)) entries.push([binding.cwd, task.projectId])
        } catch {
          // A task whose checkout is gone has no folder to match.
        }
      }
      // Longest folder first, so a repository inside a project folder wins over the folder around it.
      entries.sort((a, b) => b[0].length - a[0].length)
      this.folders = { at: Date.now(), entries }
    }
    const target = cwd.replace(/[\\/]+$/, '')
    return this.folders.entries.find(([folder]) => target === folder || target.startsWith(folder + sep))?.[1] ?? null
  }
}
