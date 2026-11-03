import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type {
  ForgeSaveConnectionInput,
  IssueLink,
  PublishRepositoryInput,
  PullRequestFeedbackKind,
  PullRequestInput,
} from '@ramu/shared/types'
import * as forge from '../../workspace/forge'
import { gitlabApi, gitlabSummary } from '../../workspace/forge/gitlab'
import { bitbucketApi, bitbucketSummary } from '../../workspace/forge/bitbucket'
import { azureSummary, verifyAzureToken } from '../../workspace/forge/azure'
import * as git from '../../workspace/git'
import { gitExclusive, writingSettings } from '../helpers'
import { id } from '../schemas'
import type { HandlerContext, RegisterHandlers } from '../types'

const issueNumber = z.number().int().positive()
const issueLink = z.object({
  repoId: id,
  number: issueNumber,
  title: z.string().max(1000),
  url: z.string().url().max(2000),
})
const publishInput = z.object({
  name: z.string().regex(/^([A-Za-z0-9-]{1,39}\/)?[A-Za-z0-9._-]{1,100}$/),
  visibility: z.enum(['private', 'public']),
})
const pullRequestInput = z.object({
  title: z.string().trim().min(1).max(500),
  body: z.string().max(100_000),
  base: z.string().min(1).max(200),
  draft: z.boolean(),
  branch: z.string().min(1).max(200).optional(),
})

const origin = z.string().min(1).max(260)
const account = z.string().min(1).max(100)
const saveInput = z.object({
  origin,
  token: z.string().min(1).max(4096),
  replaceId: id.optional(),
})

const issueKey = (taskId: string) => `issue:${taskId}`

/**
 * The issue behind the work in this checkout: the most recently active chat that was started from an
 * issue in this repository and works in the same checkout.
 */
function linkedIssue(ctx: HandlerContext, cwd: string, repoId: string): IssueLink | null {
  const { workspace } = ctx
  const chats = workspace
    .listTasks()
    .map((task) => ({ task, link: workspace.getAppState<IssueLink | null>(issueKey(task.id), null) }))
    .filter(({ link }) => link?.repoId === repoId)
    .sort((a, b) => b.task.lastActiveAt - a.task.lastActiveAt)
  for (const { task, link } of chats) {
    try {
      if (workspace.getBinding(task.id, repoId).cwd === cwd) return link
    } catch {
      // A worktree that is gone or not ready is not this checkout.
    }
  }
  return null
}

/** Pull requests for a checkout's branch and issues for a repository, through the GitHub CLI. */
export const registerForgeHandlers: RegisterHandlers = (ctx) => {
  const { workspace, gitCwdOf, forgeAccounts } = ctx
  const administrator = () => ctx.host.canAdministerIntegrations?.() === true
  const administrate = () => {
    if (!administrator()) throw new Error('Change GitHub connections on the host running Ramu')
  }
  /** Provider and store errors reach the client only after secrets are stripped. */
  const redacted = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      throw new Error(forgeAccounts.describe(error), { cause: error })
    }
  }
  const repoRoot = (repoId: string) => workspace.getRepository(repoId).root

  return {
    'forge.pullRequest': {
      args: z.tuple([id, id]),
      run: (taskId: string, repoId: string) => forge.pullRequestStatus(gitCwdOf(taskId, repoId)),
    },
    'forge.watchStatus': {
      args: z.tuple([id, id, z.string().url().max(2000)]),
      run: (taskId: string, repoId: string, url: string) =>
        ctx.pullRequestWatches?.status(gitCwdOf(taskId, repoId), url) ?? { sessionId: null, threads: [] },
    },
    'forge.watch': {
      args: z.tuple([id, id, z.string().url().max(2000), id.nullable()]),
      run: (taskId: string, repoId: string, url: string, sessionId: string | null) => {
        if (!ctx.pullRequestWatches) throw new Error('Pull request watches are unavailable.')
        return ctx.pullRequestWatches.watch(gitCwdOf(taskId, repoId), repoId, url, sessionId)
      },
    },
    'forge.sendFeedback': {
      args: z.tuple([id, id, z.enum(['checks', 'reviews'])]),
      run: (taskId: string, repoId: string, kind: PullRequestFeedbackKind) =>
        ctx.pullRequestWatches?.sendFeedback(gitCwdOf(taskId, repoId), kind) ?? null,
    },
    'forge.pullRequestDraft': {
      args: z.tuple([id, id]),
      run: async (taskId: string, repoId: string) => {
        const cwd = gitCwdOf(taskId, repoId)
        const issue = linkedIssue(ctx, cwd, repoId)
        // The commit list makes a usable draft on its own; the writing model improves it when it answers.
        const draft = await forge.pullRequestDraft(cwd, issue)
        const prefs = ctx.storedPreferences()
        const settings = writingSettings(ctx.workspace, prefs)
        const source = settings ? await forge.pullRequestSource(cwd).catch(() => null) : null
        if (!settings || !source) return draft
        const config = ctx.workspace.projectConfiguration(ctx.workspace.projectIdOf(taskId)).config.commit
        try {
          const written = await ctx.agents.draftPullRequest(source, settings, {
            style: config?.commitStyle ?? prefs.commitStyle ?? DEFAULT_APP_PREFERENCES.commitStyle,
            instructions: config?.commitInstructions ?? prefs.commitInstructions ?? '',
          })
          const closes = issue ? `Closes #${issue.number}` : ''
          const body = closes && !written.body.includes(closes) ? `${written.body}\n\n${closes}`.trim() : written.body
          return { ...draft, title: written.title, body }
        } catch {
          return draft
        }
      },
    },
    'forge.connections': {
      args: z.tuple([]),
      run: () => forge.connectionSummary(administrator()),
    },
    'forge.gitlab': {
      args: z.tuple([z.boolean()]),
      run: (check: boolean) => gitlabSummary(check),
    },
    // Like the other hosting credentials, a GitLab token changes only from the machine running the host.
    'forge.saveGitlab': {
      args: z.tuple([
        z.object({
          origin: z
            .string()
            .trim()
            .toLowerCase()
            .transform((value) => value.replace(/^https:\/\//, '').replace(/\/+$/, ''))
            .pipe(z.string().regex(/^[a-z0-9.-]+(?::\d{1,5})?$/, 'Enter a server such as gitlab.com.')),
          token: z.string().trim().min(8).max(4096),
        }),
      ]),
      run: async (input: { origin: string; token: string }) => {
        administrate()
        // Check it before saving, so a mistyped token never replaces a working one.
        await gitlabApi({ ...input, fetch }, '/user')
        await ctx.gitlab.save(input)
        return gitlabSummary(true)
      },
    },
    'forge.removeGitlab': {
      args: z.tuple([]),
      run: async () => {
        administrate()
        await ctx.gitlab.remove()
        return gitlabSummary(false)
      },
    },
    'forge.bitbucket': {
      args: z.tuple([z.boolean()]),
      run: (check: boolean) => bitbucketSummary(check, ctx.bitbucket.saved()),
    },
    // Like GitHub tokens, a Bitbucket credential changes only from the machine running the host.
    'forge.saveBitbucket': {
      args: z.tuple([
        z.object({
          email: z.string().trim().email().max(320).optional(),
          token: z.string().trim().min(8).max(4096),
        }),
      ]),
      run: async (input: { email?: string; token: string }) => {
        administrate()
        const credential = { ...(input.email ? { email: input.email } : {}), token: input.token }
        // Check it before saving, so a mistyped token never replaces a working one.
        await bitbucketApi(credential, '/user')
        await ctx.bitbucket.save(credential)
        return bitbucketSummary(true, ctx.bitbucket.saved())
      },
    },
    'forge.removeBitbucket': {
      args: z.tuple([]),
      run: async () => {
        administrate()
        await ctx.bitbucket.remove()
        return bitbucketSummary(false, null)
      },
    },
    'forge.azure': {
      args: z.tuple([z.boolean()]),
      run: (check: boolean) => azureSummary(check),
    },
    // Like the other hosting credentials, an Azure DevOps token changes only from the machine running the host.
    'forge.saveAzure': {
      args: z.tuple([
        z.object({
          organization: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/, 'An organization name has letters, digits and dashes.'),
          token: z.string().trim().min(20).max(4096),
        }),
      ]),
      run: async (input: { organization: string; token: string }) => {
        administrate()
        // Check it before saving, so a mistyped token never replaces a working one.
        await verifyAzureToken(input, input.organization)
        await ctx.azure.save(input)
        return azureSummary(true)
      },
    },
    'forge.removeAzure': {
      args: z.tuple([]),
      run: async () => {
        administrate()
        await ctx.azure.remove()
        return azureSummary(false)
      },
    },
    // Credentials change only from the machine running the host: never from a paired client, an agent tool or a viewer.
    'forge.saveConnection': {
      args: z.tuple([saveInput]),
      run: async (input: ForgeSaveConnectionInput) => {
        administrate()
        return redacted(() => forgeAccounts.save(input))
      },
    },
    'forge.checkConnection': {
      args: z.tuple([id]),
      run: async (connectionId: string) => {
        administrate()
        return redacted(() => forgeAccounts.check(connectionId))
      },
    },
    'forge.setConnectionEnabled': {
      args: z.tuple([id, z.boolean()]),
      run: (connectionId: string, enabled: boolean) => {
        administrate()
        forgeAccounts.setEnabled(connectionId, enabled)
      },
    },
    'forge.removeConnection': {
      args: z.tuple([id]),
      run: async (connectionId: string) => {
        administrate()
        await redacted(() => forgeAccounts.remove(connectionId))
      },
    },
    'forge.selectAccount': {
      args: z.tuple([origin, account]),
      run: (originName: string, accountId: string) => {
        administrate()
        forgeAccounts.select(originName, accountId)
      },
    },
    'forge.setRepositoryAccount': {
      args: z.tuple([id, id, account.nullable()]),
      run: async (taskId: string, repoId: string, accountId: string | null) => {
        administrate()
        const remote = await forge.forgeRemoteOf(gitCwdOf(taskId, repoId))
        if (!remote) throw new Error('This repository has no GitHub remote.')
        forgeAccounts.setRepositoryAccount(remote.origin, remote.owner, remote.repo, accountId)
      },
    },
    'forge.checkAccess': {
      args: z.tuple([id, id]),
      run: (taskId: string, repoId: string) => forge.checkAccess(gitCwdOf(taskId, repoId)),
    },
    'forge.searchRepositories': {
      args: z.tuple([z.string().max(200), z.string().max(260).optional()]),
      run: (search: string, origin?: string) => redacted(() => forge.searchRepositories(search, undefined, origin)),
    },
    'forge.repositoryAccount': {
      args: z.tuple([id, id]),
      run: (taskId: string, repoId: string) => forge.repositoryAccount(gitCwdOf(taskId, repoId)),
    },
    'forge.publishRepository': {
      args: z.tuple([id, id, publishInput]),
      run: (taskId: string, repoId: string, input: PublishRepositoryInput) =>
        gitExclusive(ctx, taskId, repoId, (cwd) => forge.publishRepository(cwd, input)),
    },
    'forge.createPullRequest': {
      args: z.tuple([id, id, pullRequestInput]),
      run: (taskId: string, repoId: string, input: PullRequestInput) =>
        gitExclusive(ctx, taskId, repoId, async (cwd) => {
          // On the base branch the commits move to a new branch first; the base branch itself is left alone.
          if (input.branch) {
            if ((await git.currentBranch(cwd)) !== input.base)
              throw new Error(`Switch to ${input.base} to open a pull request from its commits.`)
            await git.branchFromHere(cwd, input.branch)
          }
          // The branch must be on the remote first; push publishes it when it has no upstream yet.
          await git.push(cwd)
          const status = await forge.createPullRequest(cwd, input)
          // PR creation succeeded even if watch setup fails; never encourage retrying the create action.
          await ctx.pullRequestWatches?.watchCreated(taskId, cwd, repoId, status.pullRequest).catch((error) => {
            console.error('Could not start pull request watch:', error)
          })
          return status
        }),
    },
    'forge.pullRequestFeedback': {
      args: z.tuple([id, id, z.enum(['checks', 'reviews'])]),
      run: (taskId: string, repoId: string, kind: PullRequestFeedbackKind) =>
        forge.pullRequestFeedback(gitCwdOf(taskId, repoId), kind),
    },
    'forge.issues': {
      args: z.tuple([id, z.string().max(500)]),
      // A plain folder (not yet initialized as a repository) has no issues; `gh` would only fail.
      run: (repoId: string, search: string) => {
        const root = repoRoot(repoId)
        return existsSync(join(root, '.git')) ? forge.listIssues(root, search) : []
      },
    },
    'forge.issue': {
      args: z.tuple([id, issueNumber]),
      run: async (repoId: string, number: number) => {
        const issue = await forge.issueDetails(repoRoot(repoId), number)
        return { link: { repoId, number, title: issue.title, url: issue.url }, prompt: issue.prompt }
      },
    },
    'forge.linkIssue': {
      args: z.tuple([id, issueLink.nullable()]),
      run: (taskId: string, link: IssueLink | null) => {
        workspace.getTask(taskId)
        workspace.setAppState(issueKey(taskId), link)
      },
    },
    'forge.issueLink': {
      args: z.tuple([id]),
      run: (taskId: string) => workspace.getAppState<IssueLink | null>(issueKey(taskId), null),
    },
  }
}
