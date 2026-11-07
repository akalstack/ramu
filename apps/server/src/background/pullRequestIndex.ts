import type {
  PullRequestDraftBatch,
  PullRequestList,
  PullRequestSummary,
  RepositoryBinding,
  Task,
  TaskPullRequest,
} from '@ramu/shared/types'
import { pullRequestStage } from '@ramu/shared/pullRequests'
import type { Workspace } from '../workspace/workspace'
import type { AgentService } from '../agent'
import { listPullRequests } from '../workspace/forge'
import { currentBranch } from '../workspace/git'

const LINKS_KEY = 'pull-request-links'
/** How old a repository's list may be before the background look reads it again. */
const STALE = 2 * 60_000
/** A repository whose service is unavailable (signed out, no CLI) is asked again only this often. */
const UNAVAILABLE_PAUSE = 10 * 60_000
const RATE_LIMIT_PAUSE = 10 * 60_000

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
    const batch = this.drafts().find((entry) => entry.url === chosen.url)
    const drafted =
      batch?.kind === 'review'
        ? !!batch.body || batch.comments.length > 0
        : !!batch && batch.drafts.some((draft) => draft.outcome !== 'skipped' && !draft.postedId)
    const working =
      !!batch &&
      this.agents.list(task.id).some((session) => session.id === batch.sessionId && session.state === 'running')
    return {
      repoId: chosen.repoId,
      number: chosen.number,
      title: chosen.snapshot.title,
      url: chosen.url,
      state: chosen.snapshot.state,
      draft: chosen.snapshot.draft,
      stage: pullRequestStage(chosen.snapshot, { draftsReady: drafted && !working, agentWorking: working }),
    }
  }

  /** The list for the Pull requests tab: the cached one when fresh, otherwise a new read. */
  async list(
    cwd: string,
    repoId: string,
    options: { includeClosed: boolean; force: boolean },
  ): Promise<PullRequestList> {
    if (options.includeClosed) {
      const list = await listPullRequests(cwd, { includeClosed: true })
      this.absorb(repoId, list, null)
      return list
    }
    const entry = this.entries.get(repoId)
    if (!options.force && entry?.list && Date.now() - entry.at < 15_000) return entry.list
    return (await this.read(repoId, cwd)) ?? { availability: 'ready', viewer: null, pullRequests: [] }
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
    for (const [repoId, root] of repos) {
      if (this.stopping) return
      const entry = this.entries.get(repoId)
      if (entry?.pending || (entry && now - entry.at < STALE) || (entry?.retryAt && now < entry.retryAt)) continue
      await this.read(repoId, root).catch((error) => console.error('Pull request list:', error))
    }
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
