import { randomUUID } from 'node:crypto'
import type {
  PullRequestDraftBatch,
  ReviewDraftBatch,
  ReviewReplyBatch,
  ReviewReplyDraft,
  PullRequestThread,
  ReviewVerdict,
  SendRepliesInput,
  SendRepliesResult,
} from '@ramu/shared/types'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Workspace } from '../workspace/workspace'
import type { AgentService } from '../agent'
import {
  pullRequestStatus,
  replyToThread,
  requestReviews,
  resolveThread,
  reviewThreads,
  submitReview,
} from '../workspace/forge'
import { currentBranch, push } from '../workspace/git'

const KEY = 'pull-request-drafts'

/** What the person changed in the drafts card. */
export type DraftEdit =
  | { kind: 'replies'; edits: { threadId: string; outcome: ReviewReplyDraft['outcome']; reply: string }[] }
  | { kind: 'review'; verdict: ReviewVerdict; body: string; comments: { id: string; body: string }[] }
const MAX_REPLY = 8_000

/**
 * What agents draft for pull requests: replies to review threads on the person's own pull request, and reviews of
 * someone else's. Nothing reaches the hosting service until the person sends it.
 */
export class PullRequestDrafts {
  constructor(
    private readonly workspace: Workspace,
    private readonly agents: AgentService,
    private readonly changed: () => void,
    /** The account a repository's pull requests are read as, so the person's own comments are never "reviewers". */
    private readonly viewer: (repoId: string) => string | null = () => null,
  ) {}

  /** People to ask for review again: everyone trusted who commented in the round, except the person and bots. */
  reviewersOf(repoId: string, threads: PullRequestThread[]): string[] {
    const viewer = this.viewer(repoId)?.toLowerCase()
    const names = threads.flatMap((thread) =>
      thread.comments
        .filter(
          (comment) => comment.trusted && !comment.bot && comment.author && comment.author.toLowerCase() !== viewer,
        )
        .map((comment) => comment.author!),
    )
    return [...new Set(names)]
  }

  /** The session's checkout of `url`, found among its repositories. */
  private async checkoutOf(sessionId: string, url: string) {
    const session = this.agents.get(sessionId)
    for (const binding of this.workspace.listBindings(session.taskId)) {
      if (binding.folderOnly || binding.notGit || !session.covers.includes(binding.cwd)) continue
      const status = await pullRequestStatus(binding.cwd, url).catch(() => null)
      if (status?.pullRequest?.url === url) return { binding, pr: status.pullRequest }
    }
    throw new Error('Check out the branch of that pull request in this thread first.')
  }

  /** The thread's open round for `url`, started from the service's open threads when there is none yet. */
  private async repliesFor(sessionId: string, url: string): Promise<ReviewReplyBatch> {
    const batch = this.get(url)
    if (batch?.kind === 'replies' && batch.sessionId === sessionId) return batch
    const { binding, pr } = await this.checkoutOf(sessionId, url)
    const threads = (await reviewThreads(binding.cwd, url)).filter((thread) => !thread.resolved)
    return this.begin({
      url,
      number: pr.number,
      repoId: binding.repoId,
      branch: pr.headBranch,
      sessionId,
      threads,
      reviewers: this.reviewersOf(binding.repoId, threads),
    })
  }

  private async reviewFor(sessionId: string, url: string): Promise<ReviewDraftBatch> {
    const batch = this.get(url)
    if (batch?.kind === 'review' && batch.sessionId === sessionId) return batch
    const { binding, pr } = await this.checkoutOf(sessionId, url)
    return this.beginReview({ url, number: pr.number, repoId: binding.repoId, sessionId })
  }

  list(): PullRequestDraftBatch[] {
    return this.workspace.getAppState<PullRequestDraftBatch[]>(KEY, [])
  }

  get(url: string): PullRequestDraftBatch | null {
    return this.list().find((batch) => batch.url === url) ?? null
  }

  private save(batches: PullRequestDraftBatch[]): void {
    this.workspace.setAppState(KEY, batches)
    this.changed()
  }

  private upsert(batch: PullRequestDraftBatch): void {
    this.save([...this.list().filter((entry) => entry.id !== batch.id && entry.url !== batch.url), batch])
  }

  discard(batchId: string): void {
    this.save(this.list().filter((batch) => batch.id !== batchId))
  }

  /**
   * The person's edits in the card, kept on the host so they survive the agent revising other drafts and so the agent
   * sees them when asked to change a reply.
   */
  edit(batchId: string, change: DraftEdit): void {
    const batch = this.list().find((entry) => entry.id === batchId)
    if (!batch) throw new Error('These drafts were already sent or replaced. Refresh and try again.')
    if (change.kind === 'replies' && batch.kind === 'replies')
      this.upsert({
        ...batch,
        drafts: batch.drafts.map((draft) => {
          const edit = change.edits.find((entry) => entry.threadId === draft.threadId)
          return edit && !draft.postedId
            ? { ...draft, outcome: edit.outcome, reply: edit.reply.trim().slice(0, MAX_REPLY) }
            : draft
        }),
      })
    else if (change.kind === 'review' && batch.kind === 'review')
      this.upsert({
        ...batch,
        verdict: change.verdict,
        body: change.body.trim(),
        comments: batch.comments
          .filter((comment) => change.comments.some((entry) => entry.id === comment.id))
          .map((comment) => ({ ...comment, body: change.comments.find((entry) => entry.id === comment.id)!.body })),
      })
    else throw new Error('These drafts changed kind. Refresh and try again.')
  }

  /** Starts a round: the threads handed to the agent, so the card can show each comment beside its draft. */
  begin(input: {
    url: string
    number: number
    repoId: string
    branch: string
    sessionId: string
    threads: PullRequestThread[]
    reviewers: string[]
  }): ReviewReplyBatch {
    const previous = this.get(input.url)
    // A new round keeps drafts the person has not sent yet for threads that are still in it.
    const kept =
      previous?.kind === 'replies'
        ? previous.drafts.filter(
            (draft) => !draft.postedId && input.threads.some((thread) => thread.id === draft.threadId),
          )
        : []
    const batch: ReviewReplyBatch = {
      kind: 'replies',
      id: previous?.kind === 'replies' ? previous.id : randomUUID(),
      createdAt: Date.now(),
      ...input,
      threads: [
        ...input.threads,
        ...(previous?.kind === 'replies'
          ? previous.threads.filter(
              (thread) =>
                kept.some((draft) => draft.threadId === thread.id) && !input.threads.some((t) => t.id === thread.id),
            )
          : []),
      ],
      drafts: kept,
    }
    this.upsert(batch)
    return batch
  }

  /** The tools a thread's lead uses to record its drafts; registered with the pull request watch tools. */
  register(server: McpServer, sessionId: string): void {
    const result = async (work: () => unknown) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await work()) }] }
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] }
      }
    }
    server.registerTool(
      'review_drafts',
      {
        description:
          'Read what is drafted for a pull request in this thread: each review thread with its comments and the current reply and outcome, including edits the person made. Use it before revising drafts when the person asks for changes.',
        inputSchema: { url: z.string().url().max(2000) },
      },
      ({ url }) =>
        result(() => {
          const batch = this.get(url)
          if (!batch || batch.sessionId !== sessionId) return { drafted: false }
          if (batch.kind === 'review')
            return { drafted: true, kind: 'review', verdict: batch.verdict, body: batch.body, comments: batch.comments }
          return {
            drafted: true,
            kind: 'replies',
            threads: batch.threads.map((thread) => ({
              threadId: thread.id,
              where: thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ''}` : 'conversation',
              comments: thread.comments.map(
                (comment) => `${comment.author ?? 'someone'}: ${comment.body.slice(0, 2_000)}`,
              ),
              draft: batch.drafts.find((draft) => draft.threadId === thread.id) ?? null,
            })),
          }
        }),
    )
    server.registerTool(
      'review_reply',
      {
        description:
          'Record your answer to one review thread of a pull request you were asked to address. outcome: fixed (you committed the change; give the commit), no-change (explain why the code stays), question (ask the reviewer one specific question), skipped (nothing to post). Write reply to the reviewer, briefly, in the first person of the pull request author. Calling it again for the same thread replaces the draft, which is how to revise one when the person asks. Ramu shows the drafts to the person, who sends them; never push or post replies yourself.',
        inputSchema: {
          url: z.string().url().max(2000),
          threadId: z.string().min(1).max(300),
          outcome: z.enum(['fixed', 'no-change', 'question', 'skipped']),
          reply: z.string().max(MAX_REPLY),
          commit: z
            .string()
            .regex(/^[0-9a-f]{7,40}$/i)
            .optional(),
        },
      },
      ({ url, threadId, outcome, reply, commit }) =>
        result(async () => {
          const batch = await this.repliesFor(sessionId, url)
          if (!batch.threads.some((thread) => thread.id === threadId))
            throw new Error('That review thread is not part of this round. Use a thread id from the feedback.')
          if (outcome !== 'skipped' && !reply.trim()) throw new Error('Write the reply the reviewer will read.')
          const draft: ReviewReplyDraft = { threadId, outcome, reply: reply.trim(), commit: commit ?? null }
          this.upsert({ ...batch, drafts: [...batch.drafts.filter((entry) => entry.threadId !== threadId), draft] })
          const left = batch.threads.filter(
            (thread) => thread.id !== threadId && !batch.drafts.some((entry) => entry.threadId === thread.id),
          ).length
          return { recorded: true, threadsLeft: left }
        }),
    )
    server.registerTool(
      'draft_review',
      {
        description:
          'Record your review of a pull request you were asked to review: an overall verdict (comment, approve or request-changes), a short summary body, and inline comments on lines of the new version (path relative to the repository, line number in the changed file). Calling it again replaces the draft. Ramu shows it to the person, who edits and posts it; never post reviews yourself.',
        inputSchema: {
          url: z.string().url().max(2000),
          verdict: z.enum(['comment', 'approve', 'request-changes']),
          body: z.string().max(20_000),
          comments: z
            .array(
              z.object({
                path: z.string().min(1).max(1000),
                line: z.number().int().positive(),
                body: z.string().min(1).max(MAX_REPLY),
              }),
            )
            .max(60),
        },
      },
      ({ url, verdict, body, comments }) =>
        result(async () => {
          const batch = await this.reviewFor(sessionId, url)
          this.upsert({
            ...batch,
            verdict: verdict as ReviewVerdict,
            body: body.trim(),
            comments: comments.map((comment) => ({ ...comment, id: randomUUID() })),
          })
          return { recorded: true }
        }),
    )
  }

  /** Starts a review round for someone else's pull request. */
  beginReview(input: { url: string; number: number; repoId: string; sessionId: string }): ReviewDraftBatch {
    const batch: ReviewDraftBatch = {
      kind: 'review',
      id: randomUUID(),
      createdAt: Date.now(),
      verdict: 'comment',
      body: '',
      comments: [],
      ...input,
    }
    this.upsert(batch)
    return batch
  }

  private cwdOf(batch: PullRequestDraftBatch): string {
    const session = this.agents.get(batch.sessionId)
    return this.workspace.getBinding(session.taskId, batch.repoId).cwd
  }

  /**
   * Pushes (when asked), then posts each checked reply, then resolves and re-requests review. A failed push posts
   * nothing. Each posted reply is recorded at once, and a reply already on the thread is never posted again.
   */
  async sendReplies(batchId: string, input: SendRepliesInput): Promise<SendRepliesResult> {
    const found = this.list().find((entry) => entry.id === batchId)
    if (found?.kind !== 'replies')
      throw new Error('These replies were already sent or replaced. Refresh and try again.')
    let batch: ReviewReplyBatch = {
      ...found,
      drafts: found.drafts.map((draft) => {
        const edit = input.edits.find((entry) => entry.threadId === draft.threadId)
        return edit ? { ...draft, outcome: edit.outcome, reply: edit.reply.trim().slice(0, MAX_REPLY) } : draft
      }),
    }
    const cwd = this.cwdOf(batch)
    if ((await currentBranch(cwd)) !== batch.branch)
      throw new Error(`Switch back to ${batch.branch} first. Nothing was pushed or posted.`)
    const status = await pullRequestStatus(cwd, batch.url)
    if (status.pullRequest?.state !== 'open')
      throw new Error('This pull request is no longer open. Nothing was posted.')
    let pushed = false
    if (input.push) {
      await push(cwd, batch.branch)
      pushed = true
    }
    const threads = await reviewThreads(cwd, batch.url)
    const failed: SendRepliesResult['failed'] = []
    let posted = 0
    const record = (threadId: string, change: Partial<ReviewReplyDraft>) => {
      batch = {
        ...batch,
        drafts: batch.drafts.map((draft) => (draft.threadId === threadId ? { ...draft, ...change } : draft)),
      }
      this.upsert(batch)
    }
    for (const draft of batch.drafts) {
      if (draft.outcome === 'skipped' || draft.postedId || !draft.reply) continue
      const body =
        draft.outcome === 'fixed' && draft.commit ? `${draft.reply}\n\nFixed in ${draft.commit}.` : draft.reply
      const thread = threads.find((entry) => entry.id === draft.threadId)
      const already = thread?.comments.find((comment) => comment.createdAt >= found.createdAt && comment.body === body)
      try {
        const id = already?.id ?? (await replyToThread(cwd, batch.url, draft.threadId, body))
        record(draft.threadId, { postedId: id, error: null })
        posted++
        if (input.resolveFixed && draft.outcome === 'fixed' && thread?.resolvable && !thread.resolved)
          await resolveThread(cwd, batch.url, draft.threadId).catch(() => {})
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        record(draft.threadId, { error: message })
        failed.push({ threadId: draft.threadId, error: message })
      }
    }
    if (input.requestReview && batch.reviewers.length && !failed.length)
      await requestReviews(cwd, batch.url, batch.reviewers).catch((error) =>
        failed.push({ threadId: '', error: error instanceof Error ? error.message : String(error) }),
      )
    if (!failed.length) this.discard(batch.id)
    return { pushed, posted, failed }
  }

  async sendReview(
    batchId: string,
    review: { verdict: ReviewVerdict; body: string; comments: { path: string; line: number; body: string }[] },
  ): Promise<void> {
    const batch = this.list().find((entry) => entry.id === batchId)
    if (batch?.kind !== 'review') throw new Error('This review was already posted or replaced. Refresh and try again.')
    await submitReview(this.cwdOf(batch), batch.url, {
      verdict: review.verdict,
      body: review.body.trim(),
      comments: review.comments.map((comment) => ({ ...comment, id: randomUUID() })),
    })
    this.discard(batch.id)
  }

  /** Batches whose thread is gone go with it. */
  prune(): void {
    const kept = this.list().filter((batch) => {
      try {
        this.agents.get(batch.sessionId)
        return true
      } catch {
        return false
      }
    })
    if (kept.length !== this.list().length) this.save(kept)
  }
}
