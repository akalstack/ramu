import type {
  PullRequestDraftBatch,
  PullRequestList,
  PullRequestSummary,
  RepositoryBinding,
  RepositoryPullRequests,
  Task,
  TaskPullRequest,
} from '@ramu/shared/types'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { NO_PROJECT } from '@ramu/shared/types'
import { outsideRepoId, outsideRepository, pullRequestStage } from '@ramu/shared/pullRequests'
import type { Workspace } from '../workspace/workspace'
import type { AgentService } from '../agent'
import { listInvolvedPullRequests, listPullRequests, listRepositoryPullRequests } from '../workspace/forge'
import { currentBranch } from '../workspace/git'

const LINKS_KEY = 'pull-request-links'
/** How old a repository's list may be before the background look reads it again. */
const STALE = 2 * 60_000
/** A repository whose service is unavailable (signed out, no CLI) is asked again only this often. */
const UNAVAILABLE_PAUSE = 10 * 60_000
const RATE_LIMIT_PAUSE = 10 * 60_000
/** Repositories read at once for the Pull requests page and the background look; each read is a CLI or API call. */
const OVERVIEW_READS = 6

/** Runs `work` on every item, `limit` at a time. */
async function eachLimited<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      await work(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** A thread's pull request, kept with what was last seen of it so the row stays right between looks. */
interface Link {
  repoId: string
  url: string
  number: number
  snapshot: Pick<
    PullRequestSummary,
    'title' | 'state' | 'draft' | 'checks' | 'reviewDecision' | 'mergeable' | 'openThreads'
  >
}

interface Entry {
  at: number
  list: PullRequestList | null
  /** The branch the repository's own checkout had out at that look, for current-checkout threads. */
  checkedOut: string | null
  pending?: Promise<PullRequestList | null>
  retryAt?: number
}

/**
 * Pull requests per repository, read in the background for repositories with threads and on demand for the list. It
 * links each pull request to the thread working on its branch, so thread rows on every device show its state.
 */
export class PullRequestIndex {
  private readonly entries = new Map<string, Entry>()
  private running: Promise<void> | null = null
  private stopping = false
  /** Supplied by the draft service: drafted replies or reviews waiting per pull request URL. */
  drafts: () => PullRequestDraftBatch[] = () => []

  constructor(
    private readonly workspace: Workspace,
    private readonly agents: AgentService,
    private readonly changed: () => void,
  ) {}

  /** Read once per process: thread lists ask for every thread's link on each refresh. */
  private cached: Record<string, Link[]> | null = null

  private links(): Record<string, Link[]> {
    this.cached ??= this.workspace.getAppState<Record<string, Link[]>>(LINKS_KEY, {})
    return this.cached
  }

  private saveLinks(next: Record<string, Link[]>): boolean {
    if (JSON.stringify(next) === JSON.stringify(this.links())) return false
    this.workspace.setAppState(LINKS_KEY, next)
    this.cached = next
    return true
  }

  /** Records that a thread works on a pull request: created, watched or opened from Ramu. */
  link(
    taskId: string,
    repoId: string,
    pr: Pick<PullRequestSummary, 'url' | 'number'> & Partial<Link['snapshot']>,
  ): void {
    const all = this.links()
    const current = all[taskId] ?? []
    const previous = current.find((entry) => entry.url === pr.url)
    const snapshot: Link['snapshot'] = {
      title: pr.title ?? previous?.snapshot.title ?? '',
      state: pr.state ?? previous?.snapshot.state ?? 'open',
      draft: pr.draft ?? previous?.snapshot.draft ?? false,
      checks: pr.checks ?? previous?.snapshot.checks ?? null,
      reviewDecision: pr.reviewDecision ?? previous?.snapshot.reviewDecision ?? null,
      mergeable: pr.mergeable ?? previous?.snapshot.mergeable ?? 'unknown',
      openThreads: pr.openThreads ?? previous?.snapshot.openThreads ?? null,
    }
    const next = [
      ...current.filter((entry) => entry.url !== pr.url),
      { repoId, url: pr.url, number: pr.number, snapshot },
    ]
    if (this.saveLinks({ ...all, [taskId]: next })) this.changed()
  }

  /** Threads already working on this pull request, newest link last. */
  threadsFor(url: string): string[] {
    return Object.entries(this.links())
      .filter(([, links]) => links.some((entry) => entry.url === url))
      .map(([taskId]) => taskId)
  }

  /** What a thread row shows: the open pull request first, otherwise the latest one. */
  forTask(task: Task): TaskPullRequest | null {
    const links = this.links()[task.id]
    if (!links?.length) return null
    const chosen = links.findLast((entry) => entry.snapshot.state === 'open') ?? links.at(-1)!
    const { draftsReady, agentWorking, prepared } = this.localState(chosen.url, [task.id])
    return {
      repoId: chosen.repoId,
      number: chosen.number,
      title: chosen.snapshot.title,
      url: chosen.url,
      state: chosen.snapshot.state,
      draft: chosen.snapshot.draft,
      stage: pullRequestStage(chosen.snapshot, { draftsReady, agentWorking }),
      ...(draftsReady && prepared ? { prepared } : {}),
    }
  }

  /** What Ramu itself knows about a pull request: replies drafted for it, or an agent of these threads working on it. */
  private localState(
    url: string,
    taskIds: string[],
  ): { draftsReady: boolean; agentWorking: boolean; prepared?: TaskPullRequest['prepared'] } {
    const batch = this.drafts().find((entry) => entry.url === url)
    if (!batch) return { draftsReady: false, agentWorking: false }
    const waiting =
      batch.kind === 'review'
        ? 0
        : batch.drafts.filter((draft) => draft.outcome !== 'skipped' && !draft.postedId).length
    const drafted = batch.kind === 'review' ? !!batch.body || batch.comments.length > 0 : waiting > 0
    const working = taskIds.some((taskId) =>
      this.agents.list(taskId).some((session) => session.id === batch.sessionId && session.state === 'running'),
    )
    return {
      draftsReady: drafted && !working,
      agentWorking: working,
      prepared: batch.kind === 'review' ? { kind: 'review' } : { kind: 'replies', count: waiting },
    }
  }

  /**
   * Every Git repository of every project, read through the same cache as the per-repository list, a few at a time.
   * One repository failing leaves its error on its own entry rather than failing the page.
   */
  async overview(options: { includeClosed: boolean; force: boolean }): Promise<RepositoryPullRequests[]> {
    const repositories = this.workspace
      .listProjects()
      .filter((project) => project.id !== NO_PROJECT)
      .flatMap((project) =>
        this.workspace
          .listRepositories(project.id)
          .filter((repo) => existsSync(join(repo.root, '.git')))
          .map((repo) => ({ project, repo })),
      )
    const titles = new Map(
      this.workspace
        .listTasks()
        .filter((task) => task.status !== 'archived')
        .map((task) => [task.id, task.title]),
    )
    const results: RepositoryPullRequests[] = new Array(repositories.length)
    // The search for pull requests elsewhere starts with the repositories, through the checkouts it used last time.
    const involvedEarly = options.includeClosed || options.force ? null : this.involvedEarly()
    await eachLimited(repositories, OVERVIEW_READS, async ({ project, repo }, position) => {
      const base = { projectId: project.id, projectName: project.name, repoId: repo.id, repoName: repo.name }
      try {
        // The page refreshes on its own timer and on request; a list the background look read recently is current enough.
        const list = await this.list(repo.root, repo.id, { ...options, maxAge: STALE })
        const threads: Record<string, { taskId: string; title: string }[]> = {}
        const local: RepositoryPullRequests['local'] = {}
        for (const pr of list.pullRequests) {
          const linked = this.threadsFor(pr.url).filter((taskId) => titles.has(taskId))
          if (linked.length) threads[pr.url] = linked.map((taskId) => ({ taskId, title: titles.get(taskId)! }))
          const { draftsReady, agentWorking } = this.localState(pr.url, linked)
          if (draftsReady || agentWorking) local[pr.url] = { draftsReady, agentWorking }
        }
        results[position] = { ...base, ...list, threads, local }
      } catch (error) {
        results[position] = {
          ...base,
          availability: 'ready',
          viewer: null,
          pullRequests: [],
          local: {},
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
    await involvedEarly
    const seen = new Set<string>()
    const listed = results.map((entry) => {
      const pullRequests = entry.pullRequests.filter((pr) => !seen.has(pr.url))
      for (const pr of pullRequests) seen.add(pr.url)
      return { ...entry, pullRequests }
    })
    if (options.includeClosed) return listed
    return [...listed, ...(await this.involvedElsewhere(listed, repositories, seen, options.force))]
  }

  /** The last search for pull requests involving each GitHub account, by the checkout it signed in through. */
  private involved = new Map<string, { at: number; rows: Awaited<ReturnType<typeof listInvolvedPullRequests>> }>()
  /** Searches running now, so the phone and the desktop asking at once share one. */
  private searching = new Map<
    string,
    Promise<{ at: number; rows: Awaited<ReturnType<typeof listInvolvedPullRequests>> }>
  >()

  private searchInvolved(root: string) {
    const running = this.searching.get(root)
    if (running) return running
    const search = listInvolvedPullRequests(root)
      .then((rows) => {
        const entry = { at: Date.now(), rows }
        this.involved.set(root, entry)
        return entry
      })
      .finally(() => this.searching.delete(root))
    this.searching.set(root, search)
    return search
  }

  /** Refreshes stale searches through the checkouts that found results before; failures wait for the usual search. */
  private involvedEarly(): Promise<unknown> {
    return Promise.all(
      [...this.involved]
        .filter(([, entry]) => Date.now() - entry.at >= STALE)
        .map(([root]) => this.searchInvolved(root).catch(() => null)),
    )
  }
  /**
   * The checkout whose account found each repository in no project, by lowercase `owner/repo`. Kept after the search
   * stops listing it, so a pull request open in full still reads once it is merged.
   */
  private outsideRoots = new Map<string, string>()

  /**
   * Where calls for a repository no project holds run: the checkout whose GitHub account found pull requests in it,
   * so they are read and acted on as that account. Null when no search here has listed it.
   */
  async outsideRoot(repository: string): Promise<string | null> {
    const key = repository.toLowerCase()
    if (!this.outsideRoots.has(key))
      // A restarted host has not searched yet; the page's list came from before.
      await this.overview({ includeClosed: false, force: false }).catch(() => [])
    return this.outsideRoots.get(key) ?? null
  }

  /**
   * Open pull requests that involve the person in repositories no project holds, one search per GitHub account (read
   * through the first signed-in checkout of that account), so the page also shows their work and the reviews asked of
   * them elsewhere. A failed search leaves the page as it is.
   */
  private async involvedElsewhere(
    listed: RepositoryPullRequests[],
    repositories: { repo: { id: string; root: string } }[],
    seen: Set<string>,
    force: boolean,
  ): Promise<RepositoryPullRequests[]> {
    const roots = new Map<string, string>()
    for (const entry of listed)
      if (
        (entry.service ?? 'github') === 'github' &&
        entry.availability === 'ready' &&
        !entry.error &&
        entry.viewer &&
        !roots.has(entry.viewer)
      ) {
        const root = repositories.find(({ repo }) => repo.id === entry.repoId)?.repo.root
        if (root) roots.set(entry.viewer, root)
      }
    const byRepository = new Map<string, RepositoryPullRequests>()
    const found = new Map<string, string>()
    for (const root of roots.values()) {
      let cached = this.involved.get(root)
      if (force || !cached || Date.now() - cached.at >= STALE) {
        try {
          cached = await this.searchInvolved(root)
        } catch (error) {
          console.error('Pull requests elsewhere:', error)
          continue
        }
      }
      for (const { viewer, repository, pr } of cached.rows) {
        // The first account to find a repository is the one its rows were listed as.
        if (!found.has(repository.toLowerCase())) found.set(repository.toLowerCase(), root)
        if (seen.has(pr.url)) continue
        seen.add(pr.url)
        const entry = byRepository.get(repository) ?? {
          projectId: '',
          projectName: repository,
          repoId: outsideRepoId(repository),
          repoName: repository,
          availability: 'ready' as const,
          service: 'github' as const,
          viewer,
          pullRequests: [],
          threads: {},
          local: {},
          outside: true,
        }
        entry.pullRequests.push(pr)
        byRepository.set(repository, entry)
      }
    }
    if (this.outsideRoots.size > 500) this.outsideRoots.clear()
    for (const [repository, root] of found) this.outsideRoots.set(repository, root)
    return [...byRepository.values()]
  }

  /** The list for the Pull requests tab: the cached one when fresh, otherwise a new read. */
  async list(
    cwd: string,
    repoId: string,
    options: { includeClosed: boolean; force: boolean; maxAge?: number },
  ): Promise<PullRequestList> {
    const outside = outsideRepository(repoId)
    if (outside) return this.readOutside(repoId, outside, cwd, options)
    // Every read already carries recently merged and closed pull requests, so both views share one cache.
    const entry = this.entries.get(repoId)
    if (!options.force && entry?.list && Date.now() - entry.at < (options.maxAge ?? STALE)) return entry.list
    return (await this.read(repoId, cwd)) ?? { availability: 'ready', viewer: null, pullRequests: [] }
  }

  /**
   * A repository in no project, read through `cwd`'s account with its merged and closed pull requests. No thread or
   * database branch belongs to it, so nothing is linked from the list.
   */
  private async readOutside(
    repoId: string,
    repository: string,
    cwd: string,
    options: { force: boolean; maxAge?: number },
  ): Promise<PullRequestList> {
    const entry = this.entries.get(repoId)
    if (!options.force && entry?.list && Date.now() - entry.at < (options.maxAge ?? STALE)) return entry.list
    const list = await listRepositoryPullRequests(cwd, repository)
    this.entries.set(repoId, { at: Date.now(), list, checkedOut: null })
    return list
  }

  /** The viewer the last list of this repository was read as; null before a read. */
  viewer(repoId: string): string | null {
    return this.entries.get(repoId)?.list?.viewer ?? null
  }

  /** After a push, a merge or any change on the service, the next look should not wait for the timer. */
  invalidate(repoId: string): void {
    const entry = this.entries.get(repoId)
    if (entry) entry.at = 0
  }

  private read(repoId: string, cwd: string): Promise<PullRequestList | null> {
    const existing = this.entries.get(repoId)
    if (existing?.pending) return existing.pending
    const pending = (async () => {
      const checkedOut = await currentBranch(cwd).catch(() => null)
      try {
        const list = await listPullRequests(cwd, { includeClosed: true })
        this.entries.set(repoId, {
          at: Date.now(),
          list,
          checkedOut,
          ...(list.availability === 'ready' ? {} : { retryAt: Date.now() + UNAVAILABLE_PAUSE }),
        })
        this.absorb(repoId, list, checkedOut)
        return list
      } catch (error) {
        const limited = /rate limit|HTTP 429|secondary rate/i.test(error instanceof Error ? error.message : '')
        this.entries.set(repoId, {
          at: Date.now(),
          list: existing?.list ?? null,
          checkedOut,
          retryAt: Date.now() + (limited ? RATE_LIMIT_PAUSE : STALE),
        })
        throw error
      }
    })()
    this.entries.set(repoId, { ...(existing ?? { at: 0, list: null, checkedOut: null }), pending })
    return pending.finally(() => {
      const entry = this.entries.get(repoId)
      if (entry?.pending === pending) delete entry.pending
    })
  }

  /**
   * Links threads to pull requests of their branch and refreshes every linked snapshot. A worktree thread owns its
   * branch; in the shared checkout only the most recently active thread takes the checked-out branch's pull request,
   * so older threads there do not all claim it.
   */
  /** Told every list read for a repository, such as to keep a database branch per open pull request. */
  onList: ((repoId: string, list: PullRequestList) => void) | null = null

  private absorb(repoId: string, list: PullRequestList, checkedOut: string | null): void {
    if (list.availability !== 'ready') return
    this.onList?.(repoId, list)
    const byUrl = new Map(list.pullRequests.map((pr) => [pr.url, pr]))
    const byBranch = new Map<string, PullRequestSummary>()
    for (const pr of [...list.pullRequests].sort((a, b) => a.updatedAt - b.updatedAt))
      if (
        !pr.fork &&
        (!byBranch.has(pr.headBranch) || pr.state === 'open' || byBranch.get(pr.headBranch)!.state !== 'open')
      )
        byBranch.set(pr.headBranch, pr)
    const all = this.links()
    const next: Record<string, Link[]> = {}
    for (const [taskId, links] of Object.entries(all))
      next[taskId] = links.map((entry) => {
        const pr = entry.repoId === repoId ? byUrl.get(entry.url) : undefined
        return pr ? { ...entry, snapshot: snapshotOf(pr) } : entry
      })
    const tasks = this.workspace.listTasks().filter((task) => task.status !== 'archived')
    let shared: { task: Task; pr: PullRequestSummary } | null = null
    for (const task of tasks) {
      let binding: RepositoryBinding | undefined
      try {
        binding = this.workspace.listBindings(task.id).find((entry) => entry.repoId === repoId && !entry.folderOnly)
      } catch {
        continue
      }
      if (!binding) continue
      if (binding.mode === 'worktree') {
        const pr = binding.taskBranch ? byBranch.get(binding.taskBranch) : undefined
        if (pr) next[task.id] = withLink(next[task.id], repoId, pr)
        continue
      }
      const pr = checkedOut ? byBranch.get(checkedOut) : undefined
      // Only a thread active since the pull request last changed hands can be the one working on it.
      if (pr && (!shared || task.lastActiveAt > shared.task.lastActiveAt)) shared = { task, pr }
    }
    const url = shared?.pr.url
    if (shared && !Object.values(next).some((links) => links.some((entry) => entry.url === url)))
      next[shared.task.id] = withLink(next[shared.task.id], repoId, shared.pr)
    if (this.saveLinks(next)) this.changed()
  }

  /** Forget links of deleted threads. */
  forget(taskId: string): void {
    const all = this.links()
    if (!all[taskId]) return
    const { [taskId]: _removed, ...rest } = all
    this.saveLinks(rest)
  }

  tick(): Promise<void> {
    if (this.stopping || this.running) return this.running ?? Promise.resolve()
    this.running = this.poll().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async poll(): Promise<void> {
    const now = Date.now()
    const repos = new Map<string, string>()
    for (const task of this.workspace.listTasks()) {
      if (task.status === 'archived') continue
      try {
        for (const binding of this.workspace.listBindings(task.id))
          if (!binding.folderOnly && !binding.notGit && binding.setupState === 'ready' && !repos.has(binding.repoId))
            repos.set(binding.repoId, this.workspace.getRepository(binding.repoId).root)
      } catch {
        // A thread whose project or worktree is gone has nothing to look up.
      }
    }
    const due = [...repos].filter(([repoId]) => {
      const entry = this.entries.get(repoId)
      return !(entry?.pending || (entry && now - entry.at < STALE) || (entry?.retryAt && now < entry.retryAt))
    })
    await eachLimited(due, OVERVIEW_READS, async ([repoId, root]) => {
      if (this.stopping) return
      await this.read(repoId, root).catch((error) => console.error('Pull request list:', error))
    })
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.running
  }
}

function snapshotOf(pr: PullRequestSummary): Link['snapshot'] {
  return {
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    checks: pr.checks,
    reviewDecision: pr.reviewDecision,
    mergeable: pr.mergeable,
    openThreads: pr.openThreads,
  }
}

function withLink(links: Link[] | undefined, repoId: string, pr: PullRequestSummary): Link[] {
  const rest = (links ?? []).filter((entry) => entry.url !== pr.url)
  return [...rest, { repoId, url: pr.url, number: pr.number, snapshot: snapshotOf(pr) }]
}
