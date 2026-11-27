import { repositoryIdentity } from '@ramu/shared/repositoryIdentity'
import type { Project, Repository } from '@ramu/shared/types'
import { git } from './git'

/** A remote changes rarely, and the project list is read often. */
const FRESH_MS = 10 * 60_000

/**
 * Says which repository each project is a checkout of, so a list across hosts can show one repository's projects
 * together. Read from the repository's `origin` and remembered for a while; a project with several repositories is
 * all of them together, and one with no remote names none.
 */
export class ProjectRepositories {
  private readonly known = new Map<string, { at: number; identity: string | null }>()

  constructor(
    private readonly repositories: (projectId: string) => Repository[],
    private readonly remote: (root: string) => Promise<string> = (root) => git(root, ['remote', 'get-url', 'origin']),
    private readonly now: () => number = Date.now,
  ) {}

  private async of(root: string): Promise<string | null> {
    const held = this.known.get(root)
    if (held && this.now() - held.at < FRESH_MS) return held.identity
    const identity = await this.remote(root).then(repositoryIdentity, () => null)
    this.known.set(root, { at: this.now(), identity })
    return identity
  }

  async label(projects: Project[]): Promise<Project[]> {
    return Promise.all(
      projects.map(async (project) => {
        const identities = await Promise.all(
          this.repositories(project.id).map((repository) => this.of(repository.root)),
        )
        // Every repository must be known: a project that is only partly the same is not the same project.
        if (!identities.length || identities.some((identity) => !identity)) return project
        return { ...project, repository: [...new Set(identities)].sort().join('+') }
      }),
    )
  }
}
