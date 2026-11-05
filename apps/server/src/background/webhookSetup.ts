// Setting a webhook schedule up on GitHub for the person: Ramu already holds the account the project's repositories use,
// so it creates the repository webhook with the schedule's address, secret and events, keeps it current when the
// address changes, and removes it with the schedule.
import { githubEventsFor, type WebhookTrigger } from '@ramu/shared/webhooks'
import type { Schedule } from '@ramu/shared/types'
import type { Workspace } from '../workspace/workspace'
import type { ScheduleService } from './schedules'
import {
  createRepoHook,
  deleteRepoHook,
  forgeRemoteOf,
  updateRepoHook,
  type RepoHook,
  type RepoHookConfig,
} from '../workspace/forge/github'
import { kindOfOrigin } from '../workspace/forge/route'

export interface GithubCalls {
  remoteOf: typeof forgeRemoteOf
  isGithub(origin: string): Promise<boolean>
  create: typeof createRepoHook
  update: typeof updateRepoHook
  remove: typeof deleteRepoHook
}
const realCalls: GithubCalls = {
  remoteOf: forgeRemoteOf,
  isGithub: async (origin) => (await kindOfOrigin(origin)) === 'github',
  create: createRepoHook,
  update: updateRepoHook,
  remove: deleteRepoHook,
}

export class WebhookSetup {
  constructor(
    private readonly schedules: ScheduleService,
    private readonly workspace: Workspace,
    private readonly github: GithubCalls = realCalls,
  ) {}

  /** The schedule project's repositories hosted on GitHub, to choose where the webhook goes. */
  async githubRepos(id: string): Promise<{ repoId: string; name: string; slug: string }[]> {
    const schedule = this.schedules.get(id)
    const repos = this.workspace.listRepositories(schedule.projectId)
    const found = await Promise.all(
      repos.map(async (repo) => {
        const remote = await this.github.remoteOf(repo.root)
        return remote && (await this.github.isGithub(remote.origin))
          ? { repoId: repo.id, name: repo.name, slug: `${remote.owner}/${remote.repo}` }
          : null
      }),
    )
    return found.filter((entry) => entry !== null)
  }

  /** GitHub must reach the address from the internet: an HTTPS address in front of this host. */
  private config(id: string): RepoHookConfig {
    const schedule = this.schedules.get(id)
    if (schedule.rule.kind !== 'webhook') throw new Error('This schedule does not start from webhooks')
    const { urls, secret } = this.schedules.webhook(id)
    const url = urls.find((entry) => entry.url.startsWith('https://'))?.url
    if (!url)
      throw new Error(
        'GitHub cannot reach this host yet. Run your own tunnel to it and set its address under Settings → Remote access → Public address, then try again.',
      )
    if (!secret) throw new Error('The schedule has no secret to sign requests with.')
    return { url, secret, events: githubEventsFor(schedule.rule as WebhookTrigger) }
  }

  async connectGithub(id: string, repoId: string): Promise<Schedule> {
    const repo = this.workspace.listRepositories(this.schedules.get(id).projectId).find((entry) => entry.id === repoId)
    if (!repo) throw new Error('That repository is not in the schedule’s project')
    const config = this.config(id)
    const old = this.schedules.githubHook(id)
    if (old) await this.github.remove(repo.root, old).catch(() => {})
    const hook = await this.github.create(repo.root, config)
    this.schedules.setGithubHook(id, { ...hook, repoId })
    return this.schedules.get(id)
  }

  /** After a new address or secret, or an edit that changes which events matter. */
  async refresh(id: string): Promise<void> {
    const hook = this.schedules.githubHook(id)
    const root = hook && this.rootOf(id, hook)
    if (hook && root) await this.github.update(root, hook, this.config(id))
  }

  /** Before a schedule goes, its repository webhook goes too; a failure there never keeps the schedule. */
  async beforeDelete(id: string): Promise<void> {
    const hook = this.schedules.githubHook(id)
    const root = hook && this.rootOf(id, hook)
    if (hook && root) await this.github.remove(root, hook).catch(() => {})
  }

  private rootOf(id: string, hook: RepoHook & { repoId: string }): string | null {
    return (
      this.workspace.listRepositories(this.schedules.get(id).projectId).find((entry) => entry.id === hook.repoId)
        ?.root ?? null
    )
  }
}
