import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { coversPath } from '../agent/covers'
import { pullRequestStage } from '@ramu/shared/pullRequests'
import { PULL_REQUEST_REACTIONS, PULL_REQUEST_SUPPORT } from '@ramu/shared/pullRequestSupport'
import type { PullRequestReaction, PullRequestWrite } from '@ramu/shared/types'
import type { AgentService } from '../agent'
import type { Workspace } from '../workspace/workspace'
import * as forge from '../workspace/forge'
import type { PullRequestWrites } from './pullRequestWrites'

const GUIDE =
  'Pull request tools work on GitHub, GitLab, Bitbucket and Azure DevOps alike, as the account of the thread’s repository. Use them for every pull request action instead of gh, glab or the website: each write appears in a card in this thread showing exactly what goes out. In Full access comments, replies, line comments, resolving, reactions, reviewers and edits post at once and the card offers Undo; otherwise they wait for the person to press Post. Approving, requesting changes, withdrawing a review, merging, closing and changing the base branch always wait for the person, in every mode: say it is waiting, never claim it was done. A tool that answers that the service lacks something means exactly that; tell the person in those words and post nothing else instead.'

const reference = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .describe('The pull request’s link, or its number in this thread’s repository.')
const text = z.string().trim().min(1).max(20_000)
const people = z.array(z.string().trim().min(1).max(200)).max(30)
const commentId = z.string().trim().min(1).max(300).describe('A comment id from pull_request_threads.')
const placement = {
  path: z.string().trim().min(1).max(1000).describe('File path relative to the repository.'),
  line: z.number().int().positive().max(10_000_000),
  startLine: z.number().int().positive().max(10_000_000).optional().describe('First line of a range ending at line.'),
  side: z.enum(['new', 'old']).optional().describe('new: the pull request’s version (default); old: the base’s.'),
  suggestion: z
    .string()
    .max(20_000)
    .optional()
    .describe('Replacement text for the line or range, posted as a suggested change.'),
}

/** The pull request tools of one thread; the authenticated MCP connection supplies the session. */
export function registerPullRequestTools(
  server: McpServer,
  sessionId: string,
  writes: PullRequestWrites,
  agents: AgentService,
  workspace: Workspace,
) {
  const result = async (work: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await work()) }] }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
      }
    }
  }
  const write = (name: string, description: string, input: z.ZodRawShape, build: (args: never) => PullRequestWrite) =>
    server.registerTool(
      name,
      { description: `${description} ${GUIDE}`, inputSchema: { pullRequest: reference, ...input } },
      (args: { pullRequest: string }) =>
        result(async () => {
          const outcome = await writes.request(sessionId, args.pullRequest, build(args as never))
          return {
            ...outcome,
            meaning:
              outcome.state === 'posted'
                ? 'Posted. The card offers Undo where the service can take it back.'
                : outcome.state === 'failed'
                  ? 'The service refused it; the error is in the card too.'
                  : 'Waiting in the card for the person to post it. Nothing was sent yet.',
          }
        }),
    )

  server.registerTool(
    'pull_request_list',
    {
      description: `The open pull requests of this thread’s repositories (closed and merged too when asked), each with its stage. ${GUIDE}`,
      inputSchema: { includeClosed: z.boolean().optional() },
    },
    ({ includeClosed }) =>
      result(async () => {
        const session = agents.get(sessionId)
        const bindings = workspace
          .listBindings(session.taskId)
          .filter((binding) => !binding.folderOnly && !binding.notGit && coversPath(session.covers, binding.cwd))
        return Promise.all(
          bindings.map(async (binding) => {
            const list = await forge.listPullRequests(binding.cwd, { includeClosed: includeClosed ?? false })
            return {
              repository: binding.repoName,
              service: list.service ?? 'github',
              account: list.viewer,
              pullRequests: list.pullRequests.map((pr) => ({
                number: pr.number,
                title: pr.title,
                url: pr.url,
                author: pr.author,
                stage: pullRequestStage(pr),
                base: pr.baseBranch,
                head: pr.headBranch,
              })),
            }
          }),
        )
      }),
  )
  server.registerTool(
    'pull_request_view',
    {
      description: `One pull request: title, body, state, checks, reviewers and their verdicts, labels, merge methods and what blocks a merge, the changed files, and what its service can do. ${GUIDE}`,
      inputSchema: { pullRequest: reference },
    },
    ({ pullRequest }) =>
      result(async () => {
        const place = await writes.place(sessionId, pullRequest)
        const [status, list, body, merge, files] = await Promise.all([
          forge.pullRequestStatus(place.cwd, place.url),
          forge.listPullRequests(place.cwd, { includeClosed: true }).catch(() => null),
          forge.pullRequestBody(place.cwd, place.url).catch(() => ''),
          forge.mergeOptions(place.cwd, place.url).catch(() => null),
          forge.pullRequestFiles(place.cwd, place.url).catch(() => null),
        ])
        const summary = list?.pullRequests.find((pr) => pr.url === place.url)
        const pr = status.pullRequest!
        return {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          service: place.service,
          state: pr.state,
          draft: pr.draft,
          base: pr.baseBranch,
          head: pr.headBranch,
          author: summary?.author ?? null,
          body: body.slice(0, 20_000),
          reviewDecision: pr.reviewDecision,
          requestedReviewers: summary?.requestedReviewers ?? [],
          labels: summary?.labels ?? [],
          checks: pr.checks,
          mergeable: summary?.mergeable ?? 'unknown',
          merge,
          files: files?.files.map((file) => ({
            path: file.path,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
          })),
          moreFiles: files?.more ?? false,
          canDo: Object.entries(PULL_REQUEST_SUPPORT[place.service])
            .filter(([, supported]) => supported)
            .map(([capability]) => capability),
          reactions: PULL_REQUEST_REACTIONS[place.service],
        }
      }),
  )
  server.registerTool(
    'pull_request_threads',
    {
      description: `A pull request’s review threads (id, file and line, resolved or outdated, every comment with its author and id) and its conversation comments on no file. Use these ids for replies, resolving, edits and reactions. ${GUIDE}`,
      inputSchema: { pullRequest: reference },
    },
    ({ pullRequest }) =>
      result(async () => {
        const place = await writes.place(sessionId, pullRequest)
        const [threads, conversation] = await Promise.all([
          forge.reviewThreads(place.cwd, place.url),
          forge.pullRequestConversation(place.cwd, place.url),
        ])
        const clip = (body: string) => body.slice(0, 4_000)
        return {
          threads: threads.map((thread) => ({
            threadId: thread.id,
            where: thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ''}` : 'conversation',
            resolved: thread.resolved,
            outdated: thread.outdated,
            resolvable: thread.resolvable,
            comments: thread.comments.map((comment) => ({
              commentId: comment.id,
              author: comment.author,
              body: clip(comment.body),
            })),
          })),
          conversation: conversation.map((comment) => ({
            commentId: comment.id,
            author: comment.author,
            own: comment.own,
            body: clip(comment.body),
          })),
        }
      }),
  )

  write(
    'pull_request_comment',
    'Posts a comment on the pull request itself, on no file, such as test results or a summary.',
    { body: text },
    ({ body }: { body: string }) => ({ kind: 'comment', body }),
  )
  write(
    'pull_request_reply',
    'Replies in a review thread, or under a review’s summary, by threadId from pull_request_threads.',
    { threadId: z.string().trim().min(1).max(300), body: text },
    ({ threadId, body }: { threadId: string; body: string }) => ({ kind: 'reply', threadId, body }),
  )
  write(
    'pull_request_line_comment',
    'Posts one comment on a line or range of the changed code, outside a review, optionally with a suggested change.',
    { ...placement, body: text },
    (args: {
      path: string
      line: number
      startLine?: number
      side?: 'new' | 'old'
      suggestion?: string
      body: string
    }) => ({
      kind: 'line-comment',
      comment: args,
    }),
  )
  write(
    'pull_request_review',
    'Submits one review: verdict comment, approve or request-changes, a summary, and line comments with optional suggested changes. Approving and requesting changes always wait for the person. For a review Ramu asked you to draft from the Pull requests page, use draft_review instead.',
    {
      verdict: z.enum(['comment', 'approve', 'request-changes']),
      body: z.string().trim().max(20_000),
      comments: z
        .array(z.object({ ...placement, body: text }))
        .max(60)
        .optional(),
    },
    (args: {
      verdict: 'comment' | 'approve' | 'request-changes'
      body: string
      comments?: {
        path: string
        line: number
        startLine?: number
        side?: 'new' | 'old'
        suggestion?: string
        body: string
      }[]
    }) => ({
      kind: 'review',
      verdict: args.verdict,
      body: args.body,
      comments: (args.comments ?? []).map((comment, index) => ({ ...comment, id: String(index) })),
    }),
  )
  write(
    'pull_request_resolve',
    'Resolves a review thread, or reopens it with status active. On Azure DevOps, wont-fix, by-design and closed are statuses too.',
    {
      threadId: z.string().trim().min(1).max(300),
      status: z.enum(['resolved', 'active', 'wont-fix', 'by-design', 'closed']).optional(),
    },
    ({
      threadId,
      status,
    }: {
      threadId: string
      status?: 'resolved' | 'active' | 'wont-fix' | 'by-design' | 'closed'
    }) => ({
      kind: 'thread-status',
      threadId,
      status: status ?? 'resolved',
    }),
  )
  write(
    'pull_request_edit_comment',
    'Changes the text of a comment this account wrote.',
    { commentId, body: text },
    ({ commentId: id, body }: { commentId: string; body: string }) => ({ kind: 'edit-comment', commentId: id, body }),
  )
  write(
    'pull_request_delete_comment',
    'Deletes a comment this account wrote.',
    { commentId },
    ({ commentId: id }: { commentId: string }) => ({ kind: 'delete-comment', commentId: id }),
  )
  write(
    'pull_request_react',
    'Adds or removes a reaction on a comment.',
    {
      commentId,
      reaction: z.enum(['thumbs-up', 'thumbs-down', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes']),
      remove: z.boolean().optional(),
    },
    (args: { commentId: string; reaction: PullRequestReaction; remove?: boolean }) => ({
      kind: 'react',
      commentId: args.commentId,
      reaction: args.reaction,
      remove: args.remove ?? false,
    }),
  )
  write(
    'pull_request_reviewers',
    'Requests reviewers (logins as the service names them; asking a past reviewer again re-requests them) or removes them.',
    { add: people.optional(), remove: people.optional() },
    ({ add, remove }: { add?: string[]; remove?: string[] }) => {
      if (!add?.length && !remove?.length) throw new Error('Name someone to add or remove.')
      return { kind: 'reviewers', add: add ?? [], remove: remove ?? [] }
    },
  )
  write(
    'pull_request_withdraw_review',
    'Takes back this account’s own approval or change request. Always waits for the person.',
    {},
    () => ({ kind: 'withdraw-review' }),
  )
  write(
    'pull_request_update',
    'Changes the title, body, base branch, labels or assignees. Changing the base branch always waits for the person.',
    {
      title: z.string().trim().min(1).max(500).optional(),
      body: z.string().max(60_000).optional(),
      base: z.string().trim().min(1).max(250).optional(),
      addLabels: people.optional(),
      removeLabels: people.optional(),
      addAssignees: people.optional(),
      removeAssignees: people.optional(),
    },
    (args: {
      title?: string
      body?: string
      base?: string
      addLabels?: string[]
      removeLabels?: string[]
      addAssignees?: string[]
      removeAssignees?: string[]
    }) => {
      const update = {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.base !== undefined ? { base: args.base } : {}),
        ...(args.addLabels?.length || args.removeLabels?.length
          ? { labels: { add: args.addLabels ?? [], remove: args.removeLabels ?? [] } }
          : {}),
        ...(args.addAssignees?.length || args.removeAssignees?.length
          ? { assignees: { add: args.addAssignees ?? [], remove: args.removeAssignees ?? [] } }
          : {}),
      }
      if (!Object.keys(update).length) throw new Error('Name something to change.')
      return { kind: 'update', update }
    },
  )
  write(
    'pull_request_merge',
    'Merges with an allowed method (see pull_request_view), optionally deleting the branch, or with whenChecksPass merges automatically once required checks pass. Always waits for the person.',
    {
      method: z.enum(['merge', 'squash', 'rebase']),
      deleteBranch: z.boolean().optional(),
      whenChecksPass: z.boolean().optional(),
    },
    (args: { method: 'merge' | 'squash' | 'rebase'; deleteBranch?: boolean; whenChecksPass?: boolean }) => ({
      kind: 'action',
      action: {
        kind: args.whenChecksPass ? 'auto-merge' : 'merge',
        method: args.method,
        deleteBranch: args.deleteBranch ?? false,
      },
    }),
  )
  write(
    'pull_request_state',
    'Closes or reopens the pull request, marks it ready for review or back to draft, or updates its branch from the base. Closing always waits for the person.',
    { action: z.enum(['close', 'reopen', 'ready', 'draft', 'update-branch']) },
    ({ action }: { action: 'close' | 'reopen' | 'ready' | 'draft' | 'update-branch' }) => ({
      kind: 'action',
      action: { kind: action },
    }),
  )
  write('pull_request_rerun_checks', 'Runs the failed checks of the latest commit again.', {}, () => ({
    kind: 'rerun-checks',
  }))
}
