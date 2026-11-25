// Live pull request updates: GitHub tells this host the moment a pull request, a review or a check changes in one of the
// person's repositories, so every view reads it again at once instead of at its next poll. Each repository takes the
// best source it can have:
// - the Ramu GitHub App, through Ramu Link (GithubAppEvents): no admin rights and no public address needed;
// - else a webhook Ramu adds to the repository, pointing at the host's public address (needs admin rights);
// - polling stays underneath both, so a repository with neither is still kept current, only more slowly.
import { randomBytes } from 'node:crypto'
import type { LivePullRequestRepo, LivePullRequestStatus } from '@ramu/shared/types'
import type { RepoEventState } from '@ramu/shared/pullRequestEvents'
import type { RepoHook, RepoHookConfig } from '../workspace/forge/github'
import type { AppEventsState } from './githubAppEvents'
import { signatureMatches } from './webhookReceiver'

export const LIVE_PULL_REQUEST_PATH = '/hooks/pr/'
/** What changes a pull request, its reviews or its checks. */
export const LIVE_PULL_REQUEST_EVENTS = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'pull_request_review_thread',
  'issue_comment',
  'check_run',
  'check_suite',
  'status',
  'push',
] as const
const STATE_KEY = 'live-pull-requests'
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/
/** GitHub sends a burst for one push (checks, statuses, the push); more than this a minute is a loop or a leak. */
const MAX_PER_MINUTE = 120
const SIGNATURE = { kind: 'hmac', header: 'x-hub-signature-256', prefix: 'sha256=', encoding: 'hex' } as const

interface StoredRepo {
  /** `origin/owner/repo`, lower-cased. */
  slug: string
  name: string
  root: string
  token: string
  secret: string
  hook: RepoHook | null
  /** The address the hook was last pointed at. */
  url: string | null
  problem: LivePullRequestRepo['problem'] | null
  lastDelivery: number | null
}
interface Stored {
  enabled: boolean
  repos: StoredRepo[]
}

export interface LivePullRequestHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  /** Every repository checkout of the person's projects. */
  repositories(): { name: string; root: string }[]
  /** The GitHub repository a checkout publishes to; null when it is not on GitHub. */
  githubRepository(root: string): Promise<{ origin: string; owner: string; repo: string } | null>
  /** The host's public https address, or null without one. */
  publicUrl(): string | null
  create(root: string, config: RepoHookConfig): Promise<RepoHook>
  update(root: string, hook: RepoHook, config: RepoHookConfig): Promise<void>
  remove(root: string, hook: RepoHook): Promise<void>
  /** A GitHub token that reads the checkout's repository, for proving access to the App's events. */
  readToken(root: string): Promise<string | null>
  /** The App's events through Ramu Link; absent where the host has no relay. */
  app?: {
    start(): void
    stop(): void
    state(): AppEventsState
    repoState(repo: string): RepoEventState | undefined
  }
  /** A repository's pull requests changed (`''`: any of them may have): read them again everywhere. */
  changed(root: string): void
  /** Settings shown to the person changed. */
  statusChanged(): void
}

/** The App lives on github.com; a GitHub Enterprise server has only webhooks. */
const onGithubCom = (slug: string) => slug.startsWith('github.com/')

const newToken = () => randomBytes(24).toString('base64url')
const newSecret = () => randomBytes(32).toString('hex')

/** GitHub lets only a repository's admins manage its webhooks; its answer then is a 403 or a 404. */
const problemOf = (error: unknown): NonNullable<LivePullRequestRepo['problem']> =>
  /HTTP 40[34]|not found|must have admin|resource not accessible/i.test(
    error instanceof Error ? error.message : String(error),
  )
    ? 'needs-admin'
    : 'failed'

export class LivePullRequests {
  private readonly recent = new Map<string, number[]>()
  private syncing: Promise<void> | null = null
  /** A sync asked for while one runs: it runs once more after, with what changed meanwhile. */
  private again: Promise<void> | null = null
  constructor(private readonly host: LivePullRequestHost) {}

  private read(): Stored {
    return this.host.getState<Stored>(STATE_KEY, { enabled: false, repos: [] })
  }
  private write(state: Stored): void {
    this.host.setState(STATE_KEY, state)
    this.host.statusChanged()
  }

  /** What the App's relay says about a repository, on github.com only. */
  private appState(slug: string, name: string): RepoEventState | undefined {
    if (!onGithubCom(slug) || this.host.app?.state() !== 'connected') return undefined
    return this.host.app.repoState(name)
  }

  status(): LivePullRequestStatus {
    const state = this.read()
    return {
      enabled: state.enabled,
      reachable: !!this.address(),
      app: state.enabled ? (this.host.app?.state() ?? 'off') : 'off',
      repos: state.repos.map((repo) => {
        const app = this.appState(repo.slug, repo.name)
        const source = app === 'live' ? 'app' : repo.hook && !repo.problem ? 'webhook' : null
        return {
          name: repo.name,
          slug: repo.slug,
          state: !state.enabled ? 'off' : source ? 'live' : repo.problem ? 'problem' : 'pending',
          ...(source ? { source } : {}),
          ...(app ? { app } : {}),
          ...(!source && repo.problem ? { problem: repo.problem } : {}),
          lastDelivery: repo.lastDelivery,
        }
      }),
    }
  }

  /** The repositories the App's relay should watch, grouped by the GitHub token that reads each. */
  async watched(): Promise<{ token: string; repos: string[] }[]> {
    const groups = new Map<string, string[]>()
    for (const repo of this.read().repos) {
      if (!onGithubCom(repo.slug)) continue
      const token = await this.host.readToken(repo.root).catch(() => null)
      if (token) groups.set(token, [...(groups.get(token) ?? []), repo.name.toLowerCase()])
    }
    return [...groups].map(([token, repos]) => ({ token, repos }))
  }

  /** The App's relay said a watched repository changed. */
  appEvent(repo: string, now = Date.now()): void {
    const state = this.read()
    const found = state.repos.find((entry) => onGithubCom(entry.slug) && entry.name.toLowerCase() === repo)
    if (!state.enabled || !found) return
    this.delivered(state, found, now)
    this.host.changed(found.root)
  }

  /** The relay connection came back: whatever changed while it was away is read again once. */
  appReconnected(): void {
    if (this.read().enabled) this.host.changed('')
  }

  private delivered(state: Stored, repo: StoredRepo, now: number) {
    // The list shows when GitHub last reached the host; saying so once a minute is enough.
    const news = !repo.lastDelivery || now - repo.lastDelivery > 60_000
    repo.lastDelivery = now
    if (news) this.write(state)
    else this.host.setState(STATE_KEY, state)
  }

  /** Turns live updates on (and adds the webhooks) or off (and removes them again). */
  async setEnabled(enabled: boolean): Promise<LivePullRequestStatus> {
    this.write({ ...this.read(), enabled })
    await this.sync()
    return this.status()
  }

  /**
   * Brings the webhooks in line with the projects and the address: added for a new GitHub repository, pointed at a new
   * address, removed for a repository no project holds any more, or all removed when live updates are off.
   */
  sync(): Promise<void> {
    // One already running read the state before this change, so another follows it rather than standing in for it.
    if (this.syncing)
      return (this.again ??= this.syncing
        .catch(() => {})
        .then(() => {
          this.again = null
          return this.sync()
        }))
    this.syncing = this.syncNow().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private address(): string | null {
    const base = this.host.publicUrl()
    return base?.startsWith('https://') ? base.replace(/\/$/, '') : null
  }

  private async syncNow(): Promise<void> {
    const state = this.read()
    if (state.enabled) this.host.app?.start()
    else this.host.app?.stop()
    const wanted = new Map<string, { name: string; root: string }>()
    if (state.enabled)
      for (const checkout of this.host.repositories()) {
        const remote = await this.host.githubRepository(checkout.root).catch(() => null)
        if (!remote) continue
        const slug = `${remote.origin}/${remote.owner}/${remote.repo}`.toLowerCase()
        if (!wanted.has(slug)) wanted.set(slug, { name: `${remote.owner}/${remote.repo}`, root: checkout.root })
      }
    const base = this.address()
    const repos: StoredRepo[] = []
    for (const old of state.repos)
      if (!wanted.has(old.slug) && old.hook) await this.host.remove(old.root, old.hook).catch(() => {})
    for (const [slug, checkout] of wanted) {
      const repo: StoredRepo = state.repos.find((entry) => entry.slug === slug) ?? {
        slug,
        name: checkout.name,
        root: checkout.root,
        token: newToken(),
        secret: newSecret(),
        hook: null,
        url: null,
        problem: null,
        lastDelivery: null,
      }
      repo.root = checkout.root
      repos.push(repo)
      // The App covers it: a webhook Ramu added earlier goes, so the repository keeps only one.
      if (this.appState(slug, repo.name) === 'live') {
        if (repo.hook) await this.host.remove(repo.root, repo.hook).catch(() => {})
        repo.hook = null
        repo.url = null
        repo.problem = null
        continue
      }
      if (!base) {
        repo.problem = 'no-address'
        continue
      }
      const config: RepoHookConfig = {
        url: `${base}${LIVE_PULL_REQUEST_PATH}${repo.token}`,
        secret: repo.secret,
        events: [...LIVE_PULL_REQUEST_EVENTS],
      }
      try {
        if (!repo.hook) repo.hook = await this.host.create(repo.root, config)
        else if (repo.url !== config.url) await this.host.update(repo.root, repo.hook, config)
        repo.url = config.url
        repo.problem = null
      } catch (error) {
        // A hook removed on GitHub by hand is added again next time.
        if (repo.hook && /HTTP 404|not found/i.test(error instanceof Error ? error.message : '')) repo.hook = null
        repo.problem = problemOf(error)
      }
    }
    // Turning the setting off or on while this ran is kept; the sync queued behind this one acts on it.
    this.write({ enabled: this.read().enabled, repos })
  }

  /** A delivery from GitHub. The address token finds the repository; its secret proves GitHub sent it. */
  receive(
    token: string,
    headers: Record<string, string | string[] | undefined>,
    raw: Buffer,
    now = Date.now(),
  ): { status: 202 | 204 | 401 | 404 | 429 } {
    const state = this.read()
    const repo = state.enabled && TOKEN.test(token) ? state.repos.find((entry) => entry.token === token) : undefined
    if (!repo) return { status: 404 }
    const times = (this.recent.get(token) ?? []).filter((at) => now - at < 60_000)
    if (times.length >= MAX_PER_MINUTE) return { status: 429 }
    this.recent.set(token, [...times, now])
    const flat: Record<string, string> = {}
    for (const [name, value] of Object.entries(headers))
      if (value !== undefined) flat[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
    if (!signatureMatches(SIGNATURE, repo.secret, flat, raw)) return { status: 401 }
    this.delivered(state, repo, now)
    if (flat['x-github-event'] === 'ping') return { status: 204 }
    this.host.changed(repo.root)
    return { status: 202 }
  }
}
