import { randomUUID } from 'node:crypto'
import type {
  ForgeService,
  PullRequestCapability,
  PullRequestWrite,
  PullRequestWriteCard,
  PullRequestWriteItem,
  ReviewCommentDraft,
} from '@ramu/shared/types'
import {
  PULL_REQUEST_REACTIONS,
  supportsPullRequest,
  unsupportedPullRequestText,
} from '@ramu/shared/pullRequestSupport'
import { parseForgeRemote } from '@ramu/shared/forgeRemote'
import type { Workspace } from '../workspace/workspace'
import type { AgentService } from '../agent'
import * as forge from '../workspace/forge'
import { git } from '../workspace/git'

const KEY = 'pull-request-writes'
/** Cards kept per host; the oldest settled ones go first. */
const MAX_CARDS = 200

/** Where a pull request lives for one thread: the checkout whose account reads and writes it. */
export interface PullRequestPlace {
  cwd: string
  repoId: string
  url: string
  number: number
  title: string
  service: ForgeService
}

/** The capability a write needs, so a service that lacks it is refused before anything is sent. */
export function capabilityOf(write: PullRequestWrite): PullRequestCapability[] {
  switch (write.kind) {
    case 'comment':
      return ['comment']
    case 'reply':
      return ['reply']
    case 'line-comment':
      return ['line-comment', ...(write.comment.suggestion !== undefined ? (['suggestion'] as const) : [])]
    case 'review':
      return [
        ...(write.verdict === 'approve' ? (['approve'] as const) : []),
        ...(write.verdict === 'request-changes' ? (['request-changes'] as const) : []),
        ...(write.comments.some((comment) => comment.suggestion !== undefined) ? (['suggestion'] as const) : []),
      ]
    case 'thread-status':
      return [write.status === 'active' ? 'unresolve' : write.status === 'resolved' ? 'resolve' : 'thread-status']
    case 'edit-comment':
      return ['edit-comment']
    case 'delete-comment':
      return ['delete-comment']
    case 'react':
      return ['reactions']
    case 'reviewers':
      return [
        ...(write.add.length ? (['reviewers'] as const) : []),
        ...(write.remove.length ? (['remove-reviewers'] as const) : []),
      ]
    case 'withdraw-review':
      return ['withdraw-review']
    case 'update':
      return [
        ...(write.update.labels ? (['labels'] as const) : []),
        ...(write.update.assignees ? (['assignees'] as const) : []),
        ...(write.update.base !== undefined ? (['base-branch'] as const) : []),
      ]
    case 'action':
      return write.action.kind === 'draft' ? ['draft'] : write.action.kind === 'auto-merge' ? ['auto-merge'] : []
    case 'rerun-checks':
      return ['rerun-checks']
  }
}

/** The service's refusal for a write it cannot do, in words the agent repeats; null when it can. */
export function unsupportedWrite(service: ForgeService, write: PullRequestWrite): string | null {
  const missing = capabilityOf(write).find((capability) => !supportsPullRequest(service, capability))
  if (missing) return unsupportedPullRequestText(service, missing)
  if (write.kind === 'react' && !PULL_REQUEST_REACTIONS[service].includes(write.reaction))
    return `${service === 'azure' ? 'Azure DevOps' : service} has no “${write.reaction}” reaction. Use one of: ${PULL_REQUEST_REACTIONS[service].join(', ')}.`
  return null
}

/**
 * Judgments the reviewer's team relies on, and most cannot be undone: these wait for the person in every mode.
 * Everything else posts at once in Full access.
 */
export function isDecision(write: PullRequestWrite): boolean {
  if (write.kind === 'review') return write.verdict !== 'comment'
  if (write.kind === 'withdraw-review') return true
  if (write.kind === 'update') return write.update.base !== undefined
  if (write.kind === 'action') return ['merge', 'auto-merge', 'close'].includes(write.action.kind)
  return false
}

/** Writes the service can take back after they posted, and how. */
const UNDOABLE = new Set<PullRequestWrite['kind']>([
  'comment',
  'reply',
  'line-comment',
  'thread-status',
  'react',
  'reviewers',
])

/** Sends one write to the service. Returns the id of a posted comment, so Undo can delete it. */
export async function performWrite(cwd: string, url: string, write: PullRequestWrite): Promise<string | undefined> {
  switch (write.kind) {
    case 'comment':
      return forge.commentOnPullRequest(cwd, url, write.body)
    case 'reply':
      return forge.replyToThread(cwd, url, write.threadId, write.body)
    case 'line-comment':
      return forge.lineComment(cwd, url, write.comment)
    case 'review':
      await forge.submitReview(cwd, url, { verdict: write.verdict, body: write.body, comments: write.comments })
      return undefined
    case 'thread-status':
      await forge.setThreadStatus(cwd, url, write.threadId, write.status)
      return undefined
    case 'edit-comment':
      await forge.editComment(cwd, url, write.commentId, write.body)
      return undefined
    case 'delete-comment':
      await forge.deleteComment(cwd, url, write.commentId)
      return undefined
    case 'react':
      await forge.reactToComment(cwd, url, write.commentId, write.reaction, write.remove)
      return undefined
    case 'reviewers':
      if (write.add.length) await forge.requestReviews(cwd, url, write.add)
      if (write.remove.length) await forge.removeReviewers(cwd, url, write.remove)
      return undefined
    case 'withdraw-review':
      await forge.withdrawReview(cwd, url)
      return undefined
    case 'update':
      await forge.updatePullRequest(cwd, url, write.update)
      return undefined
    case 'action':
      await forge.pullRequestAction(cwd, url, write.action)
      return undefined
    case 'rerun-checks':
      await forge.rerunChecks(cwd, url)
      return undefined
  }
}

/** The write that takes a posted one back. */
export function undoOf(item: PullRequestWriteItem): PullRequestWrite | null {
  const write = item.write
  switch (write.kind) {
    case 'comment':
    case 'reply':
    case 'line-comment':
      return item.postedId ? { kind: 'delete-comment', commentId: item.postedId } : null
    case 'thread-status':
      return { ...write, status: write.status === 'active' ? 'resolved' : 'active' }
    case 'react':
      return { ...write, remove: !write.remove }
    case 'reviewers':
      return { kind: 'reviewers', add: write.remove, remove: write.add }
    default:
      return null
  }
}

/** One line naming a write, for the agent's result and the approval sentence. */
export function describeWrite(write: PullRequestWrite): string {
  switch (write.kind) {
    case 'comment':
      return 'a comment on the pull request'
    case 'reply':
      return 'a reply in a review thread'
    case 'line-comment':
      return `a comment on ${write.comment.path}:${write.comment.line}`
    case 'review':
      return write.verdict === 'approve'
        ? 'an approval'
        : write.verdict === 'request-changes'
          ? 'a review requesting changes'
          : 'a review'
    case 'thread-status':
      return write.status === 'active' ? 'reopening a thread' : 'resolving a thread'
    case 'edit-comment':
      return 'an edit to a comment'
    case 'delete-comment':
      return 'deleting a comment'
    case 'react':
      return write.remove ? 'removing a reaction' : 'a reaction'
    case 'reviewers':
      return 'a change of reviewers'
    case 'withdraw-review':
      return 'withdrawing the account’s review'
    case 'update':
      return write.update.base !== undefined ? 'changing the base branch' : 'a change to the pull request'
    case 'action':
      return {
        merge: 'merging it',
        'auto-merge': 'merging it once checks pass',
        close: 'closing it',
        reopen: 'reopening it',
        ready: 'marking it ready for review',
        draft: 'turning it back into a draft',
        'update-branch': 'updating its branch',
      }[write.action.kind]
    case 'rerun-checks':
      return 'running failed checks again'
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * What agents ask to post on pull requests. Each write lands in a card in the thread: decisions always wait for the
 * person, everything else waits outside Full access, and a posted comment is recorded at once so it is never posted
 * twice. The person's own Post, Undo and Dismiss go through the same calls.
 */
export class PullRequestWrites {
  constructor(
    private readonly workspace: Workspace,
    private readonly agents: AgentService,
    private readonly changed: () => void,
    /** The identity check before Ramu acts as an account; throws when the account belongs to another identity. */
    private readonly guard: (taskId: string, cwd: string, action: string) => Promise<void>,
  ) {}

  list(): PullRequestWriteCard[] {
    return this.workspace.getAppState<PullRequestWriteCard[]>(KEY, [])
  }

  get(cardId: string): PullRequestWriteCard | null {
    return this.list().find((card) => card.id === cardId) ?? null
  }

  private save(card: PullRequestWriteCard): void {
    const others = this.list().filter((entry) => entry.id !== card.id)
    this.workspace.setAppState(KEY, [...others, card].slice(-MAX_CARDS))
    this.changed()
  }

  /** The thread's repository a pull request belongs to: a URL is matched to a checkout's remote, a number to the only one. */
  async place(sessionId: string, reference: string): Promise<PullRequestPlace> {
    const session = this.agents.get(sessionId)
    const bindings = this.workspace
      .listBindings(session.taskId)
      .filter((binding) => !binding.folderOnly && !binding.notGit && session.covers.includes(binding.cwd))
    if (!bindings.length) throw new Error('This thread has no Git repository to find pull requests in.')
    const number = /^#?(\d{1,9})$/.exec(reference.trim())
    let cwd: string
    let url: string
    if (number) {
      if (bindings.length > 1)
        throw new Error('This thread has several repositories. Give the pull request’s full link instead of a number.')
      cwd = bindings[0]!.cwd
      const list = await forge.listPullRequests(cwd, { includeClosed: true })
      const found = list.pullRequests.find((pr) => pr.number === Number(number[1]))
      if (!found) throw new Error(`No pull request #${number[1]} was found in this repository.`)
      url = found.url
    } else {
      url = reference.trim()
      const binding = await this.bindingFor(bindings, url)
      cwd = binding.cwd
    }
    const repoId = bindings.find((binding) => binding.cwd === cwd)!.repoId
    const service = await forge.serviceOf(cwd)
    const status = await forge.pullRequestStatus(cwd, url)
    const pr = status.pullRequest
    if (!pr) throw new Error('That pull request could not be read with this repository’s account.')
    return { cwd, repoId, url: pr.url, number: pr.number, title: pr.title, service }
  }

  /** The checkout with a remote naming the pull request's repository. */
  private async bindingFor<T extends { cwd: string }>(bindings: T[], url: string): Promise<T> {
    let link: URL
    try {
      link = new URL(url)
    } catch {
      throw new Error('Give a pull request link or its number.')
    }
    const path = decodeURIComponent(link.pathname).toLowerCase()
    for (const binding of bindings) {
      const remotes = (await git(binding.cwd, ['remote', '-v']).catch(() => ''))
        .split('\n')
        .map((line) => parseForgeRemote(line.split(/\s+/)[1] ?? ''))
      if (
        remotes.some(
          (remote) =>
            remote &&
            link.host.toLowerCase().endsWith(remote.origin.replace(/:\d+$/, '').replace(/^ssh\./, '')) &&
            path.includes(`/${remote.owner.toLowerCase()}/${remote.repo.toLowerCase()}/`),
        )
      )
        return binding
    }
    // Azure DevOps's SSH remotes name the project and repository without the `_git` the link has.
    if (bindings.length === 1) return bindings[0]!
    throw new Error('That pull request is not in a repository of this thread.')
  }

  /** The thread's card for this turn on this pull request, or a new one shown in the transcript. */
  private cardFor(sessionId: string, place: PullRequestPlace, account: string | null): PullRequestWriteCard {
    const turnStart = this.agents
      .events(sessionId)
      .filter((event) => event.kind === 'user')
      .reduce((latest, event) => Math.max(latest, event.at ?? 0), 0)
    const existing = this.list()
      .filter((card) => card.sessionId === sessionId && card.url === place.url && card.createdAt >= turnStart)
      .at(-1)
    if (existing) return existing
    const card: PullRequestWriteCard = {
      id: randomUUID(),
      sessionId,
      repoId: place.repoId,
      url: place.url,
      number: place.number,
      title: place.title,
      service: place.service,
      account,
      items: [],
      createdAt: Date.now(),
    }
    this.save(card)
    this.agents.pullRequestWritesShown(sessionId, card.id)
    return card
  }

  /**
   * An agent's write: refused when the service lacks it, posted at once in Full access unless it is a decision, and
   * otherwise left waiting in the card. Never throws for a failed post: the card keeps the error, and so does the result.
   */
  async request(
    sessionId: string,
    reference: string,
    write: PullRequestWrite,
  ): Promise<{ state: PullRequestWriteItem['state']; what: string; error?: string; cardId: string }> {
    const place = await this.place(sessionId, reference)
    const refusal = unsupportedWrite(place.service, write)
    if (refusal) throw new Error(refusal)
    const account = (await forge.repositoryAccount(place.cwd).catch(() => null))?.login ?? null
    const card = this.cardFor(sessionId, place, account)
    const item: PullRequestWriteItem = {
      id: randomUUID(),
      write,
      decision: isDecision(write),
      state: 'waiting',
      at: Date.now(),
    }
    this.save({ ...card, items: [...card.items, item] })
    const session = this.agents.get(sessionId)
    if (session.settings.access === 'full' && !item.decision) {
      const posted = await this.post(card.id, [item.id])
      const after = posted.items.find((entry) => entry.id === item.id)!
      return {
        state: after.state,
        what: describeWrite(write),
        ...(after.error ? { error: after.error } : {}),
        cardId: card.id,
      }
    }
    return { state: 'waiting', what: describeWrite(write), cardId: card.id }
  }

  private cwdOf(card: PullRequestWriteCard): { cwd: string; taskId: string } {
    const session = this.agents.get(card.sessionId)
    return { cwd: this.workspace.getBinding(session.taskId, card.repoId).cwd, taskId: session.taskId }
  }

  private update(cardId: string, itemId: string, change: Partial<PullRequestWriteItem>): PullRequestWriteCard {
    const card = this.get(cardId)
    if (!card) throw new Error('This card is gone. Ask the agent again.')
    const next = { ...card, items: card.items.map((item) => (item.id === itemId ? { ...item, ...change } : item)) }
    this.save(next)
    return next
  }

  /**
   * Posts the waiting writes named (all of them when none are), in the order they were asked for. The identity check
   * runs first and posts nothing on a mismatch. Each result is recorded as it lands.
   */
  async post(
    cardId: string,
    itemIds?: string[],
    edits: { itemId: string; body: string }[] = [],
  ): Promise<PullRequestWriteCard> {
    const card = this.get(cardId)
    if (!card) throw new Error('This card is gone. Ask the agent again.')
    const { cwd, taskId } = this.cwdOf(card)
    const chosen = card.items.filter(
      (item) => (item.state === 'waiting' || item.state === 'failed') && (!itemIds || itemIds.includes(item.id)),
    )
    if (!chosen.length) return card
    await this.guard(taskId, cwd, 'Posting on this pull request')
    let latest = card
    for (const item of chosen) {
      const edit = edits.find((entry) => entry.itemId === item.id)
      const write = edit ? withBody(item.write, edit.body) : item.write
      if (edit) latest = this.update(cardId, item.id, { write })
      try {
        const postedId = await performWrite(cwd, card.url, write)
        latest = this.update(cardId, item.id, {
          state: 'posted',
          error: undefined,
          ...(postedId ? { postedId } : {}),
          undoable:
            UNDOABLE.has(write.kind) &&
            (postedId !== undefined || !['comment', 'reply', 'line-comment'].includes(write.kind)),
        })
      } catch (error) {
        latest = this.update(cardId, item.id, { state: 'failed', error: errorText(error) })
      }
    }
    return latest
  }

  /** Takes a posted write back where the service can. */
  async undo(cardId: string, itemId: string): Promise<PullRequestWriteCard> {
    const card = this.get(cardId)
    const item = card?.items.find((entry) => entry.id === itemId)
    if (!card || !item) throw new Error('This card is gone. Ask the agent again.')
    const reverse = item.state === 'posted' && item.undoable ? undoOf(item) : null
    if (!reverse) throw new Error('This cannot be undone from Ramu. Change it on the pull request’s page.')
    const { cwd, taskId } = this.cwdOf(card)
    await this.guard(taskId, cwd, 'Undoing on this pull request')
    await performWrite(cwd, card.url, reverse)
    return this.update(cardId, itemId, { state: 'undone', undoable: false })
  }

  /** Drops waiting writes without posting them; the agent sees they were dismissed. */
  dismiss(cardId: string, itemIds?: string[]): PullRequestWriteCard {
    const card = this.get(cardId)
    if (!card) throw new Error('This card is gone. Ask the agent again.')
    const next = {
      ...card,
      items: card.items.map((item) =>
        (item.state === 'waiting' || item.state === 'failed') && (!itemIds || itemIds.includes(item.id))
          ? { ...item, state: 'dismissed' as const }
          : item,
      ),
    }
    this.save(next)
    return next
  }
}

/** A write with the person's edited text, for the writes that carry text. */
function withBody(write: PullRequestWrite, body: string): PullRequestWrite {
  const text = body.trim()
  switch (write.kind) {
    case 'comment':
    case 'reply':
    case 'edit-comment':
      return { ...write, body: text }
    case 'review':
      return { ...write, body: text }
    case 'line-comment':
      return { ...write, comment: { ...write.comment, body: text } satisfies Omit<ReviewCommentDraft, 'id'> }
    default:
      return write
  }
}
