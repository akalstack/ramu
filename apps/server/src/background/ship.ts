// Ship carries a thread's change to the project's finish line. It is built on the pull request watch: the watch hands
// failing checks and review comments to the thread, and Ship counts those rounds, tells the agent to push its fixes,
// and says what comes next when the pull request reaches the finish line, needs merging or is merged.
import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ramuMessage } from '@ramu/shared/chat/visibleMessage'
import type { PullRequestFeedbackKind, PullRequestWaiting } from '@ramu/shared/types'
import { parseForgeRemote } from '@ramu/shared/forgeRemote'
import {
  DEFAULT_SHIP_LIMITS,
  DEFAULT_SHIP_OPTIONS,
  FINISH_LINES,
  SHIP_OPTIONS,
  defaultFinishLine,
  earlierFinishLine,
  shipOptions,
  shipStep,
  type FinishLine,
  type ShipLimits,
  type ShipOptions,
  type ShipStep,
} from '@ramu/shared/ship'
import type { ShipActivity, ShipProjectStatus } from '@ramu/shared/types/ship'
import type { AgentService } from '../agent'
import type { Workspace } from '../workspace/workspace'
import { currentBranch, git, headOid, push } from '../workspace/git'
import { pullRequestStatus } from '../workspace/forge'
import { committedShipConfig, type ShipConfig } from '../workspace/projectConfig'
import { coversPath } from '../agent/covers'
import type { PullRequestWatchService, ShipRounds } from './pullRequestWatches'

const RUNS = 'ship-runs'
const ACTIVITY = 'ship-activity'
/** What Ship did unasked is listed for a week, at most this many entries. */
const ACTIVITY_DAYS = 7
const ACTIVITY_MAX = 100
/** A fix is pushed within this long of its round, or the push is something else. */
const FIX_WINDOW_MS = 2 * 60 * 60_000
const INTERVAL = 60_000
/** A new pull request with no checks yet may still get them; wait this long before calling it finished. */
const CHECKS_GRACE = 5 * 60_000
/** Steps after which a pull request needs nothing more from shipping. */
const TERMINAL: ShipStep[] = ['reached', 'closed', 'deploy']
const projectKey = (projectId: string) => `ship:${projectId}`

interface ShipRun {
  id: string
  sessionId: string
  taskId: string
  finishLine: FinishLine
  limits: ShipLimits
  /** What this run may do without asking, fixed when it started from the Git host's copy of the limits. */
  options?: ShipOptions
  projectId?: string
  rounds: Record<PullRequestFeedbackKind, number>
  /** The kind of round whose limit was spent; nothing more of it is handed over until the person allows more. */
  held?: PullRequestFeedbackKind[]
  /** Pull requests this run started watching, so finishing ends only those watches. */
  watched: string[]
  /** The last step the agent was told about, per pull request, so each is said once. */
  told: Record<string, ShipStep>
  /** When each pull request was first seen open, so checks that have not registered yet are waited for. */
  seen?: Record<string, number>
  /** When each pull request began waiting on reviewers, so a reminder is drafted only after a working day. */
  waitingSince?: Record<string, number>
  /** Pull requests whose wait was already acted on once: reviewers offered, or a reminder drafted. */
  nudged?: Record<string, 'asked' | 'reminded'>
  /** Reviewers already offered a second look after their approval stopped standing, per pull request. */
  askedAgain?: Record<string, string[]>
  /** The project has no repository on a Git host yet: shipping publishes it and puts it live, with no pull request. */
  firstRelease?: boolean
  /** A check-fixing round handed over and not pushed yet: the commit the fix starts from. */
  pendingFix?: { url: string; cwd: string; branch: string; from: string; at: number }
}

/** The activity entry with where its commits live, which the host keeps and clients do not need. */
type StoredActivity = Omit<ShipActivity, 'title' | 'replies'> & {
  /** A pushed fix: its checkout and branch. */
  cwd?: string
  branch?: string
  /** Replies sent: the comments posted, which Undo deletes. */
  commentIds?: string[]
}

const LABEL: Record<FinishLine, string> = {
  'pull-request': 'a pull request with passing checks',
  review: 'an approved pull request',
  merged: 'a merged pull request',
  preview: 'a checked preview deploy',
  live: 'production, with the live address answering',
}

const ROUND_NAME: Record<PullRequestFeedbackKind, string> = { checks: 'check-fixing', reviews: 'review' }

export interface ShipHost {
  /** The live address the uptime watch follows for a project, if any. */
  liveAddress(projectId: string): string | null
  /** The account a repository's pull requests were last read as. */
  viewer(repoId: string): string | null
  /**
   * Posts a thread's drafted replies that only report a fix, pushing the fix first, and says what went out. Replies
   * that disagree or ask stay drafted for the person.
   */
  sendFixedReplies?(sessionId: string): Promise<SentReplies[]>
  /** Takes replies back off a pull request. */
  deleteReplies?(sessionId: string, url: string, commentIds: string[]): Promise<void>
  /** What a thread's pull request waits on people for, as its Git host last said. */
  waiting?(taskId: string, url: string): PullRequestWaiting | undefined
  /** Drafts a comment on a thread's pull request that waits for the person to post. */
  proposeComment?(sessionId: string, url: string, body: string): Promise<void>
  /** Creates a private repository named `name` on the person's Git host from the checkout and pushes to it. */
  publish?(cwd: string, repoId: string, name: string): Promise<void>
  /** Keeps `url` as the project's live address and asks it once: the address now watched, and whether it answered. */
  recordLive?(projectId: string, url: string): Promise<{ address: string; answers: boolean; status: number | null }>
}

/** Replies Ship posted on one pull request. */
export interface SentReplies {
  url: string
  number: number
  commentIds: string[]
}

/** A project's saved Ship choices; `finishLine` null follows the suggestion. */
interface ProjectChoice {
  finishLine?: FinishLine | null
  options?: Partial<ShipOptions>
  /** The first production deploy was allowed by the person. */
  deployedOnce?: boolean
}

export class ShipService implements ShipRounds {
  private running: Promise<void> | null = null
  private stopping = false
  private nextPoll = 0

  constructor(
    private readonly workspace: Workspace,
    private readonly agents: AgentService,
    private readonly watches: Pick<PullRequestWatchService, 'watch' | 'status'>,
    private readonly host: ShipHost,
    private readonly changed: () => void,
  ) {}

  private runs(): ShipRun[] {
    return this.workspace.getAppState<ShipRun[]>(RUNS, [])
  }

  private save(runs: ShipRun[]): void {
    this.workspace.setAppState(RUNS, runs)
    this.changed()
  }

  private update(id: string, change: (run: ShipRun) => ShipRun): void {
    this.save(this.runs().map((run) => (run.id === id ? change(run) : run)))
  }

  private runOf(sessionId: string): ShipRun | undefined {
    return this.runs().find((run) => run.sessionId === sessionId)
  }

  /** What the project's menu shows: the person's choice, what Ramu suggests, and the limit the repository sets. */
  private choice(projectId: string): ProjectChoice {
    return this.workspace.getAppState<ProjectChoice>(projectKey(projectId), {})
  }

  async projectStatus(projectId: string): Promise<ShipProjectStatus> {
    const saved = this.choice(projectId)
    const chosen = saved.finishLine
    const repositories = this.workspace.listRepositories(projectId)
    const suggestions = await Promise.all(
      repositories.map(async (repository) => {
        const origin = await git(repository.root, ['remote', 'get-url', 'origin']).catch(() => '')
        const remote = parseForgeRemote(origin.trim())
        const viewer = this.host.viewer(repository.id)
        return defaultFinishLine({
          onGitHost: remote !== null,
          personal: remote !== null && viewer !== null && remote.owner.toLowerCase() === viewer.toLowerCase(),
          liveAddress: this.host.liveAddress(projectId) !== null,
        })
      }),
    )
    const committed = await Promise.all(repositories.map((repository) => committedShipConfig(repository.root)))
    const suggested = suggestions.reduce<FinishLine>((line, next) => earlierFinishLine(line, next), 'live')
    const repositoryLimit = committed.reduce<FinishLine | null>(
      (line, config) => (config?.finishLine ? earlierFinishLine(config.finishLine, line) : line),
      null,
    )
    const forbidden = forbiddenBy(committed)
    return {
      chosen: chosen ?? null,
      suggested,
      repositoryLimit,
      finishLine: earlierFinishLine(chosen ?? suggested, repositoryLimit),
      limits: limitsOf(committed),
      options: shipOptions(saved.options, Object.fromEntries(forbidden.map((key) => [key, true]))),
      forbidden,
      deployedOnce: saved.deployedOnce === true,
    }
  }

  setProjectFinishLine(projectId: string, finishLine: FinishLine | null): void {
    this.workspace.setAppState(projectKey(projectId), { ...this.choice(projectId), finishLine })
    this.changed()
  }

  setProjectOptions(projectId: string, options: Partial<ShipOptions>): void {
    const saved = this.choice(projectId)
    this.workspace.setAppState(projectKey(projectId), { ...saved, options: { ...saved.options, ...options } })
    this.changed()
  }

  /** Starts (or restarts) shipping a thread; an agent may ask for an earlier finish line, never a later one. */
  async start(sessionId: string, requested?: FinishLine): Promise<{ finishLine: FinishLine; instructions: string }> {
    const session = this.agents.get(sessionId)
    if (session.parentId) throw new Error('Ship from the thread itself, not a helper.')
    const { projectId } = this.workspace.getTask(session.taskId)
    const status = await this.projectStatus(projectId)
    const committed = await Promise.all(
      this.workspace
        .listRepositories(projectId)
        .map((repository) => committedShipConfig(repository.root, { fetch: true })),
    )
    const limit = committed.reduce<FinishLine | null>(
      (line, config) => (config?.finishLine ? earlierFinishLine(config.finishLine, line) : line),
      null,
    )
    const unpublished = await this.unpublished(sessionId)
    // A project never published has no pull request to stop at. Asked to go live, its first release is publishing it
    // and deploying it, unless the person or the repository set an earlier finish line.
    const firstRelease =
      requested === 'live' && unpublished.length > 0 && earlierFinishLine(status.chosen ?? 'live', limit) === 'live'
    const finishLine = firstRelease ? 'live' : earlierFinishLine(earlierFinishLine(status.finishLine, limit), requested)
    // Starting again keeps the rounds spent, so asking to ship once more never buys the agent more rounds.
    const previous = this.runOf(sessionId)
    const run: ShipRun = {
      id: randomUUID(),
      sessionId,
      taskId: session.taskId,
      finishLine,
      limits: limitsOf(committed),
      // From the Git host's fresh copy, so a limit the team just committed applies to this run.
      options: shipOptions(
        this.choice(projectId).options,
        Object.fromEntries(forbiddenBy(committed).map((key) => [key, true])),
      ),
      projectId,
      rounds: previous?.rounds ?? { checks: 0, reviews: 0 },
      ...(previous?.held?.length ? { held: previous.held } : {}),
      watched: previous?.watched ?? [],
      told: {},
      ...(firstRelease ? { firstRelease } : {}),
    }
    this.save([...this.runs().filter((entry) => entry.sessionId !== sessionId), run])
    if (firstRelease) return { finishLine, instructions: firstReleaseInstructions(optionsOf(run)) }
    const onGitHost = this.workspace
      .listBindings(session.taskId)
      .some((binding) => !binding.folderOnly && !binding.notGit && coversPath(session.covers, binding.cwd))
    return { finishLine, instructions: instructions(run, onGitHost, limit) }
  }

  /** The thread's Git checkouts that have no remote yet. */
  private async unpublished(sessionId: string): Promise<{ cwd: string; repoId: string }[]> {
    const session = this.agents.get(sessionId)
    const checkouts = this.workspace
      .listBindings(session.taskId)
      .filter((binding) => !binding.folderOnly && !binding.notGit && coversPath(session.covers, binding.cwd))
    const remotes = await Promise.all(checkouts.map((binding) => git(binding.cwd, ['remote']).catch(() => 'unknown')))
    return checkouts.filter((_binding, index) => !remotes[index]!.trim())
  }

  /**
   * Publishes a first release's repositories to the person's Git host, private. Creating something on their account
   * is theirs to allow outside Full access.
   */
  async publish(sessionId: string, name: string, signal?: AbortSignal): Promise<{ published: string[] }> {
    if (!this.runOf(sessionId)?.firstRelease)
      throw new Error('Publishing is part of a first release. Call ship with finishLine "live" first.')
    if (!this.host.publish) throw new Error('This host cannot publish repositories.')
    const unpublished = await this.unpublished(sessionId)
    if (!unpublished.length) return { published: [] }
    if (unpublished.length > 1)
      throw new Error(
        'This thread has several unpublished repositories. Ask the person to publish them in Source Control.',
      )
    if (this.agents.get(sessionId).settings.access !== 'full') {
      const allowed = await this.agents.requestPermission(
        sessionId,
        `publishing ${name}`,
        `Create the private repository ${name} on your Git host and push this project to it.`,
        signal,
      )
      if (!allowed) throw new Error('The person declined. Do not retry; tell them what is left.')
    }
    const [{ cwd, repoId }] = unpublished as [{ cwd: string; repoId: string }]
    await this.host.publish(cwd, repoId, name)
    this.changed()
    return { published: [(await git(cwd, ['remote', 'get-url', 'origin']).catch(() => name)).trim()] }
  }

  /**
   * The agent deployed to production and names the address. Ramu keeps it as the project's live address, so the
   * uptime watch follows it, and asks it once; a first release ends here when it answers.
   */
  async wentLive(sessionId: string, url: string): Promise<{ address: string; answers: boolean; next: string }> {
    const run = this.runOf(sessionId)
    if (!run?.projectId || run.finishLine !== 'live')
      throw new Error('A live address is recorded while shipping to Live in production.')
    if (!this.host.recordLive) throw new Error('This host cannot check a live address.')
    const { address, answers, status } = await this.host.recordLive(run.projectId, url)
    this.changed()
    if (!answers)
      return {
        address,
        answers,
        next: `${address} did not answer${status ? ` (status ${status})` : ''}. Read the deploy’s logs, fix the cause, deploy again and call ship with liveAddress once more.`,
      }
    if (run.firstRelease) this.finish(run)
    return {
      address,
      answers,
      next: `${address} answers and is now the project’s live address, which Ramu keeps checking. Tell the person in one line, with the address.`,
    }
  }

  /** The person allowed more rounds after a limit was spent. */
  moreRounds(sessionId: string): void {
    const run = this.runOf(sessionId)
    if (!run) throw new Error('This thread is not shipping.')
    // Only a spent limit is reset, and only after the agent asked the person (the question it was told to ask).
    if (!run.held?.length) throw new Error('No round limit is spent; keep going within the rounds that are left.')
    this.update(run.id, (entry) => ({ ...entry, rounds: { checks: 0, reviews: 0 }, held: [] }))
  }

  end(sessionId: string): void {
    const run = this.runOf(sessionId)
    if (run) this.finish(run)
  }

  shipping(sessionId: string): FinishLine | null {
    return this.runOf(sessionId)?.finishLine ?? null
  }

  held(sessionId: string, kind: PullRequestFeedbackKind): boolean {
    return this.runOf(sessionId)?.held?.includes(kind) === true
  }

  /**
   * Before the watch hands a round to a shipping thread: the words that tell the agent how this round ends, or false
   * when the round limit is spent. The first refusal asks the agent to ask the person, so it shows in the Brief.
   */
  before(
    watch: { sessionId: string; cwd: string; branch: string; url: string },
    kind: PullRequestFeedbackKind,
  ): string | false | null {
    const run = this.runOf(watch.sessionId)
    if (!run) return null
    const limit = kind === 'checks' ? run.limits.maxCiFixes : run.limits.maxReviewRounds
    if (run.rounds[kind] >= limit) {
      if (run.held?.includes(kind)) return false
      this.update(run.id, (entry) => ({ ...entry, held: [...(entry.held ?? []), kind] }))
      this.agents.enqueueBackground(
        watch.sessionId,
        [
          `Ship has spent its ${limit} ${ROUND_NAME[kind]} round${limit === 1 ? '' : 's'} on ${watch.url}, and more ${kind === 'checks' ? 'failing checks' : 'review comments'} are waiting.`,
          'Do not change anything now. Ask the person with ask_user whether to run more rounds or stop shipping, in one short question with those two options.',
          'If they choose more rounds, call ship with moreRounds: true. If they choose to stop, call ship with stop: true.',
        ].join('\n'),
        { cwd: watch.cwd, branch: watch.branch },
        ramuMessage('Ship used all its rounds on {0}', { '0': watch.url }),
      )
      return false
    }
    return kind === 'checks'
      ? `This thread is shipping to ${LABEL[run.finishLine]}. This overrides "do not push" above: commit the fix on ${watch.branch} and push it, so the checks run again. Never push to the default branch.`
      : `This thread is shipping to ${LABEL[run.finishLine]}. ${
          optionsOf(run).sendReplies
            ? 'Commit each fix on ' +
              watch.branch +
              ' and record it with review_reply as fixed, with its commit: Ramu pushes the branch and posts those replies itself once you finish. A reply that disagrees with the reviewer or asks a question is recorded as no-change or question and waits for the person.'
            : 'Draft the replies as asked; the person sends them with Push and reply.'
        }`
  }

  /**
   * Whether a shipping thread may post this decision without the person: only the Git host's own auto-merge, which
   * still waits for its required reviews and checks, and only when the project allows it and ships at least to merged.
   */
  mayDecide(sessionId: string, action: string): boolean {
    const run = this.runOf(sessionId)
    return (
      !!run &&
      action === 'auto-merge' &&
      optionsOf(run).autoMerge &&
      FINISH_LINES.indexOf(run.finishLine) >= FINISH_LINES.indexOf('merged')
    )
  }

  /**
   * Whether a shipping thread's production deploy may run without the card: the project allows it, ships all the way
   * to production, and its first production deploy was already allowed by the person.
   */
  mayDeploy(sessionId: string): boolean {
    const run = this.runOf(sessionId)
    if (!run?.projectId || run.finishLine !== 'live' || !optionsOf(run).autoDeploy) return false
    return this.choice(run.projectId).deployedOnce === true
  }

  /** The person allowed a production deploy in this thread: the project's first one is behind it. */
  deployAllowed(sessionId: string): void {
    let projectId: string
    try {
      projectId = this.workspace.getTask(this.agents.get(sessionId).taskId).projectId
    } catch {
      return
    }
    const saved = this.choice(projectId)
    if (saved.deployedOnce) return
    this.workspace.setAppState(projectKey(projectId), { ...saved, deployedOnce: true })
    this.changed()
  }

  after(watch: { sessionId: string; cwd: string; branch: string; url: string }, kind: PullRequestFeedbackKind): void {
    const run = this.runOf(watch.sessionId)
    if (!run) return
    this.update(run.id, (entry) => ({ ...entry, rounds: { ...entry.rounds, [kind]: entry.rounds[kind] + 1 } }))
    // The fix the agent pushes next is Ship's doing, so remember where it starts to list it and undo it later.
    if (kind === 'checks')
      void headOid(watch.cwd).then((from) => {
        if (from)
          this.update(run.id, (entry) => ({
            ...entry,
            pendingFix: { url: watch.url, cwd: watch.cwd, branch: watch.branch, from, at: Date.now() },
          }))
      })
  }

  /** A shipping thread's checkout pushed: the commits since the handed-over round are a fix Ship made unasked. */
  async pushed(sessionId: string, cwd: string): Promise<void> {
    const run = this.runOf(sessionId)
    const pending = run?.pendingFix
    if (!run || !pending || pending.cwd !== cwd) return
    const [to, branch] = await Promise.all([headOid(cwd), currentBranch(cwd)])
    this.update(run.id, ({ pendingFix: _done, ...entry }) => entry)
    // A push from another branch, or long after the round, is other work rather than this fix.
    if (!to || to === pending.from || branch !== pending.branch || Date.now() - pending.at > FIX_WINDOW_MS) return
    const number = /\/(?:pull|pulls|pull-requests|merge_requests|pullrequest)\/(\d+)/.exec(pending.url)?.[1]
    const entry: StoredActivity = {
      id: randomUUID(),
      kind: 'checks-fixed',
      taskId: run.taskId,
      sessionId,
      url: pending.url,
      number: number ? Number(number) : null,
      from: pending.from,
      to,
      at: Date.now(),
      cwd,
      branch: pending.branch,
    }
    this.saveActivity([...this.storedActivity(), entry])
  }

  /** The person pushed from a checkout: a fix Ship follows there now starts after their commits, never including them. */
  async personPushed(cwd: string): Promise<void> {
    const run = this.runs().find((entry) => entry.pendingFix?.cwd === cwd)
    if (!run) return
    const from = await headOid(cwd)
    if (from)
      this.update(run.id, (entry) =>
        entry.pendingFix ? { ...entry, pendingFix: { ...entry.pendingFix, from, at: Date.now() } } : entry,
      )
  }

  private storedActivity(now = Date.now()): StoredActivity[] {
    return this.workspace
      .getAppState<StoredActivity[]>(ACTIVITY, [])
      .filter((entry) => now - entry.at < ACTIVITY_DAYS * 24 * 60 * 60_000)
  }

  private saveActivity(entries: StoredActivity[]): void {
    this.workspace.setAppState(ACTIVITY, entries.slice(-ACTIVITY_MAX))
    this.changed()
  }

  /** What Ship did unasked in the last week, newest first, for Inbox's Done. */
  activity(): ShipActivity[] {
    return this.storedActivity()
      .map(({ cwd: _cwd, branch: _branch, commentIds, ...entry }) => {
        let title = ''
        try {
          title = this.workspace.getTask(entry.taskId).title
        } catch {
          // A deleted thread keeps its entry, untitled, so the fix can still be undone.
        }
        return { ...entry, title, ...(commentIds ? { replies: commentIds.length } : {}) }
      })
      .reverse()
  }

  /**
   * Reverts a fix Ship pushed, with a revert commit pushed to the same branch, and tells the thread. Only while nothing
   * came after it on the branch and the checkout has no changes of its own, so the revert takes back exactly that fix.
   */
  async undo(id: string): Promise<ShipActivity[]> {
    const entry = this.storedActivity().find((candidate) => candidate.id === id)
    if (!entry) throw new Error('That fix is no longer listed.')
    if (entry.undoneAt) return this.activity()
    const done = () =>
      this.saveActivity(
        this.storedActivity().map((candidate) =>
          candidate.id === id ? { ...candidate, undoneAt: Date.now() } : candidate,
        ),
      )
    if (entry.kind === 'replies-sent') {
      if (!this.host.deleteReplies) throw new Error('Replies cannot be taken back on this host.')
      await this.host.deleteReplies(entry.sessionId, entry.url, entry.commentIds ?? [])
      done()
      return this.activity()
    }
    if (!entry.cwd || !entry.branch || !entry.from || !entry.to) throw new Error('That fix is no longer listed.')
    if ((await currentBranch(entry.cwd)) !== entry.branch || (await headOid(entry.cwd)) !== entry.to)
      throw new Error('The branch has moved on since this fix. Undo it from the thread instead.')
    if ((await git(entry.cwd, ['status', '--porcelain'])).trim())
      throw new Error('The checkout has changes that are not committed. Commit or discard them first.')
    try {
      await git(entry.cwd, ['revert', '--no-edit', `${entry.from}..${entry.to}`])
    } catch (error) {
      await git(entry.cwd, ['revert', '--abort']).catch(() => {})
      throw new Error('Git could not revert this fix cleanly. Undo it from the thread instead.', { cause: error })
    }
    try {
      await push(entry.cwd, entry.branch)
    } catch (error) {
      // An unpushed revert would leave the checkout ahead of the fix and block a retry; the checkout was clean.
      await git(entry.cwd, ['reset', '--hard', entry.to]).catch(() => {})
      throw error
    }
    done()
    try {
      this.agents.enqueueBackground(
        entry.sessionId,
        `The person undid the fix you pushed to ${entry.url} (${entry.from.slice(0, 7)}..${entry.to.slice(0, 7)}) with a revert commit, now pushed. Do not push that change again unless they ask. Reply in one line.`,
        { cwd: entry.cwd, branch: entry.branch },
        ramuMessage('You undid the fix pushed to {0}', { '0': entry.url }),
      )
    } catch {
      // A thread that is gone has nothing to tell.
    }
    return this.activity()
  }

  tick(now = Date.now()): Promise<void> {
    if (this.stopping || this.running || now < this.nextPoll) return this.running ?? Promise.resolve()
    this.nextPoll = now + INTERVAL
    this.running = this.poll().finally(() => {
      this.running = null
    })
    return this.running
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.running
  }

  private alive(run: ShipRun): boolean {
    try {
      const session = this.agents.get(run.sessionId)
      return session.state !== 'stopped' && this.workspace.getTask(run.taskId).status !== 'archived'
    } catch {
      return false
    }
  }

  /** Ends the watch this run started on one pull request, if it is still this thread's. */
  private unwatch(run: ShipRun, url: string): void {
    if (!run.watched.includes(url)) return
    const watched = this.workspace
      .listBindings(run.taskId)
      .find((binding) => this.watches.status(binding.cwd, url).sessionId === run.sessionId)
    if (watched) void this.watches.watch(watched.cwd, watched.repoId, url, null).catch(() => {})
  }

  private finish(run: ShipRun): void {
    for (const url of run.watched) this.unwatch(run, url)
    this.save(this.runs().filter((entry) => entry.id !== run.id))
  }

  private async poll(): Promise<void> {
    for (const run of this.runs()) {
      if (this.stopping) return
      if (!this.alive(run)) {
        this.save(this.runs().filter((entry) => entry.id !== run.id))
        continue
      }
      const session = this.agents.get(run.sessionId)
      for (const binding of this.workspace.listBindings(run.taskId)) {
        if (binding.folderOnly || binding.notGit || !coversPath(session.covers, binding.cwd)) continue
        try {
          await this.follow(run.id, binding.cwd, binding.repoId)
        } catch (error) {
          console.error('Ship:', binding.cwd, error)
        }
      }
      // Between turns, so a round the agent is still writing never goes out half drafted.
      if (optionsOf(run).sendReplies && session.state !== 'running' && session.state !== 'starting')
        await this.sendReplies(run).catch((error) => console.error('Ship replies:', error))
    }
  }

  /**
   * A pull request that only waits on reviewers. With nobody asked yet, the agent is told once to offer the people
   * the repository's code owners or history suggest, a request the person confirms. With people asked and a working
   * day gone, a short reminder is drafted for the person to post; it is never sent for them.
   */
  private async whileWaiting(run: ShipRun, url: string, cwd: string): Promise<void> {
    const since = run.waitingSince?.[url]
    if (since === undefined) {
      this.update(run.id, (entry) => ({ ...entry, waitingSince: { ...entry.waitingSince, [url]: Date.now() } }))
      return
    }
    const waiting = this.host.waiting?.(run.taskId, url)
    if (!waiting || waiting.changesBy.length || waiting.approvals === 0) return
    const nudged = run.nudged?.[url]
    const mark = (kind: 'asked' | 'reminded') =>
      this.update(run.id, (entry) => ({ ...entry, nudged: { ...entry.nudged, [url]: kind } }))
    const again = (waiting.dismissed ?? []).filter(
      (name) => !waiting.from.includes(name) && !run.askedAgain?.[url]?.includes(name),
    )
    if (again.length) {
      this.update(run.id, (entry) => ({
        ...entry,
        askedAgain: { ...entry.askedAgain, [url]: [...(entry.askedAgain?.[url] ?? []), ...again] },
      }))
      const branch = (await currentBranch(cwd)) ?? ''
      this.agents.enqueueBackground(
        run.sessionId,
        [
          `${url}: the approval from ${again.map((name) => `@${name}`).join(', ')} no longer stands, most likely because a later push dismissed it.`,
          'Tell the person in one line, and ask them to review again in one pull_request_reviewers call, which the person confirms.',
        ].join('\n'),
        { cwd, branch },
        ramuMessage('An approval on {0} no longer stands', { '0': url }),
      )
      return
    }
    if (!waiting.from.length) {
      if (nudged) return
      mark('asked')
      const branch = (await currentBranch(cwd)) ?? ''
      this.agents.enqueueBackground(
        run.sessionId,
        [
          `${url} is ready for review and nobody has been asked to review it.`,
          'Find who should: the repository’s CODEOWNERS for the files it changes, otherwise the people who last changed those files. Ask up to three of them in one pull_request_reviewers call, which the person confirms. If you cannot tell who, say so in one line and ask nobody.',
        ].join('\n'),
        { cwd, branch },
        ramuMessage('Nobody was asked to review {0}', { '0': url }),
      )
      return
    }
    if (nudged === 'reminded' || Date.now() < workingDayAfter(since) || !this.host.proposeComment) return
    mark('reminded')
    await this.host
      .proposeComment(
        run.sessionId,
        url,
        `${waiting.from.map((name) => `@${name}`).join(' ')} this is ready for review when you have a moment. Thanks!`,
      )
      .catch((error) => console.error('Ship reminder:', error))
  }

  /** Posts the replies that only report a fix and lists them, so the reviewer hears at once and the person can undo. */
  private async sendReplies(run: ShipRun): Promise<void> {
    const sent = (await this.host.sendFixedReplies?.(run.sessionId)) ?? []
    const posted = sent.filter((entry) => entry.commentIds.length)
    if (!posted.length) return
    this.saveActivity([
      ...this.storedActivity(),
      ...posted.map((entry): StoredActivity => ({
        id: randomUUID(),
        kind: 'replies-sent',
        taskId: run.taskId,
        sessionId: run.sessionId,
        url: entry.url,
        number: entry.number,
        commentIds: entry.commentIds,
        at: Date.now(),
      })),
    ])
  }

  /** One checkout of a shipping thread: watch its pull request once it exists, and say each next step once. */
  private async follow(runId: string, cwd: string, repoId: string): Promise<void> {
    const { pullRequest: pr, availability } = await pullRequestStatus(cwd)
    const run = this.runs().find((entry) => entry.id === runId)
    if (!run || availability !== 'ready' || !pr) return
    const firstSeen = run.seen?.[pr.url]
    // A pull request merged or closed before this run (a reused branch) is not this run's to report.
    if (firstSeen === undefined && pr.state !== 'open') return
    if (firstSeen === undefined)
      this.update(run.id, (entry) => ({ ...entry, seen: { ...entry.seen, [pr.url]: Date.now() } }))
    // Watched once; a watch the person stopped since, or gave another thread, stays as they left it.
    if (pr.state === 'open' && !run.watched.includes(pr.url) && this.watches.status(cwd, pr.url).sessionId === null) {
      await this.watches.watch(cwd, repoId, pr.url, run.sessionId)
      this.update(run.id, (entry) => ({ ...entry, watched: [...new Set([...entry.watched, pr.url])] }))
    }
    const step = shipStep(pr, run.finishLine)
    if (step === 'waiting') await this.whileWaiting(run, pr.url, cwd)
    else if (run.waitingSince?.[pr.url] !== undefined)
      // The wait ended (a review came, checks ran again): the next one starts its own clock.
      this.update(run.id, (entry) => ({
        ...entry,
        waitingSince: without(entry.waitingSince, pr.url),
        nudged: without(entry.nudged, pr.url),
        askedAgain: without(entry.askedAgain, pr.url),
      }))
    // Nothing to tell while the agent works or reviewers have the turn: the watch brings their comments back.
    if (step === 'working' || step === 'waiting' || run.told[pr.url] === step) return
    if (pr.state === 'open' && !pr.checks.length && Date.now() - (firstSeen ?? Date.now()) < CHECKS_GRACE) return
    const branch = (await currentBranch(cwd)) ?? pr.headBranch
    this.agents.enqueueBackground(
      run.sessionId,
      nextStep(step, run.finishLine, pr.url, optionsOf(run)),
      { cwd, branch },
      ramuMessage(STEP_TITLE[step], { '0': pr.url }),
    )
    this.update(run.id, (entry) => ({ ...entry, told: { ...entry.told, [pr.url]: step } }))
    const latest = this.runs().find((entry) => entry.id === runId)
    if (!latest || !TERMINAL.includes(step)) return
    // Each repository's pull request ends on its own; the run ends once all of them have.
    if (Object.keys(latest.seen ?? {}).every((url) => TERMINAL.includes(latest.told[url] ?? 'working')))
      this.finish(latest)
    else this.unwatch(latest, pr.url)
  }
}

const without = <T>(record: Record<string, T> | undefined, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record ?? {}).filter(([name]) => name !== key))

/** One working day after `since`: a wait that began on a Friday is not late on Saturday. */
export function workingDayAfter(since: number): number {
  const due = new Date(since + 24 * 60 * 60_000)
  while (due.getDay() === 0 || due.getDay() === 6) due.setDate(due.getDate() + 1)
  return due.getTime()
}

/** The options some repository's committed `ramu.json` keeps with a person. */
function forbiddenBy(committed: (ShipConfig | null)[]): (keyof ShipOptions)[] {
  return SHIP_OPTIONS.filter((key) => committed.some((config) => config?.[key] === false))
}

/** A run started before options existed asks for everything, as it did. */
const optionsOf = (run: ShipRun): ShipOptions =>
  run.options ?? { ...DEFAULT_SHIP_OPTIONS, sendReplies: false, autoDeploy: false }

function limitsOf(committed: (ShipConfig | null)[]): ShipLimits {
  const lowest = (key: keyof ShipLimits) =>
    Math.min(
      DEFAULT_SHIP_LIMITS[key],
      ...committed.flatMap((config) => (config?.[key] === undefined ? [] : [config[key]!])),
    )
  return { maxCiFixes: lowest('maxCiFixes'), maxReviewRounds: lowest('maxReviewRounds') }
}

function instructions(run: ShipRun, onGitHost: boolean, repositoryLimit: FinishLine | null): string {
  if (!onGitHost)
    return 'This thread has no Git repository on a hosting service, so there is no pull request to ship. Commit the finished change on a branch, run the project’s checks, and tell the person what is left.'
  const options = optionsOf(run)
  const merge = options.autoMerge
    ? 'When it is approved, Ramu tells you; then call pull_request_merge with whenChecksPass: true, which turns on the Git host’s auto-merge without waiting for the person'
    : 'When it is approved and checks pass, Ramu tells you; then merge it with pull_request_merge, which the person confirms'
  const production = options.autoDeploy
    ? 'deploy to production (the first production deploy of a project asks the person on a card; later ones run without asking)'
    : 'deploy to production (the person allows it on a card)'
  const finish: Record<FinishLine, string> = {
    'pull-request': 'Stop when the pull request is open, out of draft, and its checks pass. Do not wait for review.',
    review:
      'Keep going until the pull request is approved. Never merge it: the team merges. Ramu tells you when it is approved.',
    merged: `${merge}.`,
    preview: `${merge}. After the merge, deploy a preview or staging build and check it answers.`,
    live: `${merge}. After the merge, ${production} and check the live address answers.`,
  }
  const replies = options.sendReplies
    ? 'commit each fix and record it with review_reply as fixed, with its commit; Ramu pushes and posts those replies once you finish, and a reply that disagrees or asks a question waits for the person'
    : 'draft replies and fixes; the person sends them'
  return [
    `Shipping to ${LABEL[run.finishLine]}${repositoryLimit === run.finishLine ? ' (the limit this repository sets)' : ''}.`,
    '1. Finish the change on a branch, never the default branch, and run the project’s build and tests.',
    '2. Review your own diff before anyone else does and fix what you find.',
    '3. Push the branch and open a pull request whose description says what changed and what you tested.',
    `4. Ramu watches the pull request. Failing checks come back to you: fix, commit and push (up to ${run.limits.maxCiFixes} rounds). Review comments come back as rounds: ${replies} (up to ${run.limits.maxReviewRounds} rounds).`,
    `5. ${finish[run.finishLine]}`,
    'Approving, and anything not named above as running on its own, waits for the person. When you are done or blocked, say so in one line.',
  ].join('\n')
}

function firstReleaseInstructions(options: ShipOptions): string {
  return [
    'Shipping a first release to Live in production. The project is on no Git host yet, so there is no pull request: go from here to a live address without stopping to ask between steps.',
    '1. Finish the app, run the project’s build and tests, and commit on the default branch.',
    '2. Publish it: call ship with publishAs set to the repository’s name. Ramu creates a private repository on the person’s Git host and pushes; outside Full access the person allows it on a card.',
    '3. Pick where it runs: a platform the project already names (ramu.json, a platform config file), else one whose CLI is signed in on this host, else the simplest that fits the stack. Say which in one line. When it needs a token or a secret, ask once with request_secret; never ask for one in chat.',
    `4. Deploy to production with that platform’s CLI. ${options.autoDeploy ? 'The first production deploy of a project asks the person on a card; later ones run without asking.' : 'The person allows it on a card.'}`,
    '5. Call ship with liveAddress set to the production address. Ramu keeps it as the project’s live address, checks that it answers and tells you.',
    'When a step fails, fix the cause and go on. When you are done or blocked, say so in one line.',
  ].join('\n')
}

/** What happened, for the card in the thread; the message itself tells the agent what to do about it. */
const STEP_TITLE: Record<ShipStep, string> = {
  reached: '{0} reached the finish line',
  merge: '{0} is approved and its checks pass',
  deploy: '{0} is merged',
  closed: '{0} was closed without merging',
  working: '{0} is being worked on',
  waiting: '{0} is waiting for review',
}

function nextStep(step: ShipStep, finishLine: FinishLine, url: string, options: ShipOptions): string {
  switch (step) {
    case 'reached':
      return `${url} reached the finish line (${LABEL[finishLine]}). Shipping is done: tell the person in one line, with the link. No other work is needed.`
    case 'merge':
      return options.autoMerge
        ? `${url} is approved and its checks pass. Merge it: call pull_request_merge with whenChecksPass: true, which goes out without waiting for the person.`
        : `${url} is approved and its checks pass. Merge it with pull_request_merge; the person confirms the merge on its card.`
    case 'deploy':
      return `${url} is merged. Finish shipping: ${finishLine === 'live' ? 'deploy to production (a card asks the person when it needs to), then call ship with liveAddress set to the production address, which Ramu checks' : 'deploy a preview or staging build and check that it answers'}. Then tell the person in one line.`
    case 'closed':
      return `${url} was closed without merging, so shipping stopped. Tell the person in one line; do not reopen it.`
    case 'working':
    case 'waiting':
      return ''
  }
}

/** The agent's way to start, extend and end shipping, when the person asks. */
export function registerShipTools(server: McpServer, ship: ShipService, sessionId: string): void {
  const result = async (work: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await work()) }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] }
    }
  }
  server.registerTool(
    'ship',
    {
      description:
        'Ship this thread’s change when the person asks to ship it, get it to review, merge it or put it live: Ramu watches the pull request, hands back failing checks and review rounds, and says when the finish line is reached. The project sets the finish line; finishLine can only ask for an earlier one. Follow the returned instructions. One exception: when the person asks to put live a project that is on no Git host yet (such as one just created with project_create), pass finishLine "live"; the instructions then publish it privately, deploy it and record its address, using publishAs and liveAddress. liveAddress also records the production address after any deploy while shipping to live. moreRounds: true when the person allows more rounds after a limit; stop: true when they want to stop shipping.',
      inputSchema: {
        finishLine: z.enum(FINISH_LINES).optional(),
        moreRounds: z.boolean().optional(),
        stop: z.boolean().optional(),
        publishAs: z
          .string()
          .regex(/^[A-Za-z0-9._-]{1,100}$/)
          .optional()
          .describe('First release only: the name of the private repository to create, such as barbershop-booking.'),
        liveAddress: z
          .string()
          .max(2000)
          .regex(/^https?:\/\/[^\s]+$/)
          .optional()
          .describe('The production address the deploy printed, such as https://barbershop.example.app.'),
      },
    },
    ({ finishLine, moreRounds, stop, publishAs, liveAddress }, extra) =>
      result(async () => {
        if (publishAs) return ship.publish(sessionId, publishAs, extra.signal)
        if (liveAddress) return ship.wentLive(sessionId, liveAddress)
        if (stop) {
          ship.end(sessionId)
          return { shipping: false }
        }
        if (moreRounds) {
          ship.moreRounds(sessionId)
          return { shipping: ship.shipping(sessionId), rounds: 'reset' }
        }
        return ship.start(sessionId, finishLine)
      }),
  )
}
