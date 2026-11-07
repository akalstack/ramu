import { rm } from 'node:fs/promises'
import type { SyncApproval } from '@ramu/shared/protectedBranch'
import { z } from 'zod'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type { AgentSettings, CommitBranchOptions, DiffContents, PullMode } from '@ramu/shared/types'
import { discardPreview } from '../../workspace/discardPreview'
import * as files from '../../workspace/files'
import * as git from '../../workspace/git'
import * as conflicts from '../../workspace/conflicts'
import type { ConflictChoice } from '@ramu/shared/conflicts'
import { RemoteRefresh } from '../../workspace/remoteRefresh'
import {
  assertNoActiveWriter,
  gitExclusive,
  lockCheckout,
  lockRepo,
  repoKey,
  withoutAgentCredits,
  writingSettings,
} from '../helpers'
import { agentSettings, fingerprintHash, gitOid, id, pullMode, relPath } from '../schemas'
import type { RegisterHandlers } from '../types'

const branchName = z.string().min(1).max(200)
const conflictChoice = z.enum(['current', 'incoming', 'both'])
const stagedPaths = z.array(relPath).max(10_000)
const discardPaths = z.array(relPath).min(1).max(10_000)

/** Git status, staging, commits, branches, stashes and remote sync for a task's repository. */
export const registerGitHandlers: RegisterHandlers = (ctx) => {
  const { workspace, agents, lock, gitCwdOf, loadPreferences, storedPreferences } = ctx
  const remoteRefresh = new RemoteRefresh()
  /** Pull and Sync follow the saved preference, so every entry point integrates the same way. */
  const savedPullMode = (): PullMode => storedPreferences().pullMode ?? DEFAULT_APP_PREFERENCES.pullMode

  /**
   * A push from a thread is followed: CI failing on the default branch, the production deployment of that branch, or the
   * preview deployment of another, wakes that thread.
   */
  const followPush = (taskId: string, cwd: string, repoId: string) => {
    void ctx.pullRequestWatches?.watchPush(taskId, cwd, repoId).catch((error: unknown) => {
      console.error('Could not follow the push:', error)
    })
    const deploys = ctx.deploys
    if (deploys)
      void (async () => {
        const { branch } = await git.commitBranchInfo(cwd)
        const sha = await git.headOid(cwd)
        if (branch && sha) await deploys.pushed(repoId, branch, sha, taskId)
      })().catch((error: unknown) => {
        console.error('Could not follow the deployment of the push:', error)
      })
  }

  const autoPull = (t: string, r: string) =>
    gitExclusive(ctx, t, r, async (cwd) => {
      if (!loadPreferences().autoPull || agents.activeWriter([cwd])) return false
      return git.autoPull(cwd)
    })

  return {
    'git.status': {
      args: z.tuple([id, id]),
      run: (taskId: string, repoId: string) => git.status(gitCwdOf(taskId, repoId)),
    },
    'git.lineStats': {
      args: z.tuple([id, id]),
      run: (taskId: string, repoId: string) => git.lineStats(gitCwdOf(taskId, repoId)),
    },
    'git.diff': {
      args: z.tuple([id, id, relPath, z.union([z.boolean(), z.literal('all')])]),
      run: async (taskId: string, repoId: string, path: string, staged: boolean | 'all'): Promise<DiffContents> => {
        const cwd = gitCwdOf(taskId, repoId)
        await files.resolveInRoot(cwd, path)
        if (staged === true)
          return { original: await git.showBlob(cwd, 'HEAD', path), modified: await git.showBlob(cwd, 'INDEX', path) }
        const working = await files.readText(cwd, path).then(
          (f) => f.content,
          () => '',
        )
        return { original: await git.showBlob(cwd, staged === 'all' ? 'HEAD' : 'INDEX', path), modified: working }
      },
    },
    'git.conflictFile': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => conflicts.conflictFile(gitCwdOf(taskId, repoId), path),
    },
    'git.resolveConflict': {
      args: z.tuple([
        id,
        id,
        relPath,
        conflictChoice,
        z.number().int().min(0).max(10_000).optional(),
        z.string().min(1).max(200).optional(),
      ]),
      run: (taskId: string, repoId: string, path: string, choice: ConflictChoice, hunk?: number, hash?: string) =>
        gitExclusive(ctx, taskId, repoId, (cwd) =>
          conflicts.resolveConflict(cwd, path, choice, {
            ...(hunk === undefined ? {} : { hunk }),
            ...(hash ? { hash } : {}),
          }),
        ),
    },
    'git.resolveAllConflicts': {
      args: z.tuple([id, id, conflictChoice]),
      run: (taskId: string, repoId: string, choice: ConflictChoice) =>
        gitExclusive(ctx, taskId, repoId, (cwd) => conflicts.resolveAllConflicts(cwd, choice)),
    },
    'git.stage': {
      args: z.tuple([id, id, stagedPaths]),
      run: async (taskId: string, repoId: string, paths: string[]) => {
        const cwd = gitCwdOf(taskId, repoId)
        for (const p of paths) await files.resolveInRoot(cwd, p)
        return lockCheckout(ctx, cwd, () => git.stage(cwd, paths))
      },
    },
    'git.unstage': {
      args: z.tuple([id, id, stagedPaths]),
      run: async (taskId: string, repoId: string, paths: string[]) => {
        const cwd = gitCwdOf(taskId, repoId)
        for (const p of paths) await files.resolveInRoot(cwd, p)
        return lockCheckout(ctx, cwd, () => git.unstage(cwd, paths))
      },
    },
    'git.discardPreview': {
      args: z.tuple([id, id, discardPaths]),
      run: (t: string, r: string, paths: string[]) => {
        const cwd = gitCwdOf(t, r)
        return lockCheckout(ctx, cwd, () => discardPreview(cwd, paths))
      },
    },
    'git.discard': {
      args: z.tuple([id, id, discardPaths, fingerprintHash.optional()]),
      run: (t: string, r: string, paths: string[], expected?: string) => {
        const cwd = gitCwdOf(t, r)
        return lockCheckout(ctx, cwd, async () => {
          if (expected && (await discardPreview(cwd, paths)).fingerprint !== expected)
            throw new Error('Files changed since the discard preview. Refresh and review them again.')
          const current = await git.status(cwd)
          const tracked: string[] = [],
            untracked: string[] = []
          for (const path of [...new Set(paths)]) {
            await files.resolveInRoot(cwd, path)
            const entry = current.entries.find((entry) => entry.path === path)
            if (!entry?.unstaged || entry.unstaged === 'unmerged')
              throw new Error('Changes changed or need conflict resolution. Refresh before discarding.')
            if (entry.unstaged === 'untracked') untracked.push(path)
            else tracked.push(path)
          }
          await git.discardTracked(cwd, tracked)
          for (const path of untracked)
            await rm(await files.resolveEntryInRoot(cwd, path), { recursive: true, force: true })
        })
      },
    },
    'git.undoCommit': {
      args: z.tuple([id, id, gitOid]),
      run: (t: string, r: string, oid: string) => gitExclusive(ctx, t, r, (cwd) => git.undoCommit(cwd, oid)),
    },
    'git.commit': {
      args: z.tuple([
        id,
        id,
        z.string().max(100_000),
        fingerprintHash.optional(),
        gitOid.optional(),
        z
          .object({
            expectedBranch: z.string().nullable(),
            newBranch: z.string().min(1).max(200).optional(),
            autoBranch: z.boolean().optional(),
          })
          .optional(),
      ]),
      run: (
        taskId: string,
        repoId: string,
        message: string,
        expected?: string,
        amendHead?: string,
        branchOptions?: CommitBranchOptions,
      ) =>
        gitExclusive(ctx, taskId, repoId, async (cwd) => {
          if (expected && (await git.stagedPatch(cwd)).fingerprint !== expected)
            throw new Error(
              'Staged changes changed after the AI draft. Regenerate the message or clear the field to write a new one.',
            )
          if (branchOptions?.newBranch || branchOptions?.autoBranch)
            assertNoActiveWriter(ctx, cwd, 'Stop the agent in this checkout before creating a feature branch.')
          return git.commit(cwd, withoutAgentCredits(ctx, message), amendHead, branchOptions)
        }),
    },
    'git.commitBranchInfo': {
      args: z.tuple([id, id]),
      run: (t: string, r: string) => git.commitBranchInfo(gitCwdOf(t, r)),
    },
    'git.createBranch': {
      args: z.tuple([id, id, branchName]),
      run: (t: string, r: string, name: string) => gitExclusive(ctx, t, r, (cwd) => git.createBranch(cwd, name)),
    },
    'git.createBranchFrom': {
      args: z.tuple([id, id, branchName, branchName]),
      run: (t: string, r: string, name: string, from: string) =>
        gitExclusive(ctx, t, r, async (cwd) => {
          assertNoActiveWriter(ctx, cwd, 'Stop the agent in this checkout before switching branches.')
          return git.createBranchFrom(cwd, name, from)
        }),
    },
    'git.renameBranch': {
      args: z.tuple([id, id, branchName]),
      run: (t: string, r: string, name: string) => gitExclusive(ctx, t, r, (cwd) => git.renameBranch(cwd, name)),
    },
    'git.mergeBranch': {
      args: z.tuple([id, id, branchName]),
      run: (t: string, r: string, name: string) =>
        gitExclusive(ctx, t, r, async (cwd) => {
          assertNoActiveWriter(ctx, cwd, 'Stop the agent in this checkout before merging.')
          return git.mergeBranch(cwd, name)
        }),
    },
    'git.deleteBranch': {
      args: z.tuple([id, id, branchName]),
      run: (t: string, r: string, name: string) => lockRepo(ctx, r, () => git.deleteBranch(gitCwdOf(t, r), name)),
    },
    'git.stashes': { args: z.tuple([id, id]), run: (t: string, r: string) => git.stashes(gitCwdOf(t, r)) },
    'git.stashFiles': {
      args: z.tuple([id, id, gitOid]),
      run: (t: string, r: string, oid: string) => git.stashFiles(gitCwdOf(t, r), oid),
    },
    'git.stashFileDiff': {
      args: z.tuple([id, id, gitOid, relPath]),
      run: (t: string, r: string, oid: string, path: string) => git.stashFileDiff(gitCwdOf(t, r), oid, path),
    },
    'git.stash': {
      args: z.tuple([id, id, z.string().max(500), z.boolean().optional()]),
      run: (t: string, r: string, name: string, stagedOnly?: boolean) =>
        gitExclusive(ctx, t, r, (cwd) => git.stash(cwd, name, stagedOnly)),
    },
    'git.popStash': {
      args: z.tuple([id, id, gitOid]),
      run: (t: string, r: string, oid: string) => gitExclusive(ctx, t, r, (cwd) => git.popStash(cwd, oid)),
    },
    'git.applyStash': {
      args: z.tuple([id, id, gitOid]),
      run: (t: string, r: string, oid: string) => gitExclusive(ctx, t, r, (cwd) => git.applyStash(cwd, oid)),
    },
    'git.dropStash': {
      args: z.tuple([id, id, gitOid]),
      run: (t: string, r: string, oid: string) => lockRepo(ctx, r, () => git.dropStash(gitCwdOf(t, r), oid)),
    },
    'git.history': { args: z.tuple([id, id]), run: (t: string, r: string) => git.history(gitCwdOf(t, r)) },
    'git.branches': { args: z.tuple([id, id]), run: (t: string, r: string) => git.branches(gitCwdOf(t, r)) },
    'git.commitFiles': {
      args: z.tuple([id, id, gitOid]),
      run: (t: string, r: string, oid: string) => git.commitFiles(gitCwdOf(t, r), oid),
    },
    'git.commitFileDiff': {
      args: z.tuple([id, id, gitOid, relPath]),
      run: (t: string, r: string, oid: string, path: string) => git.commitFileDiff(gitCwdOf(t, r), oid, path),
    },
    'git.commitDetails': {
      args: z.tuple([id, id, gitOid]),
      run: (t: string, r: string, oid: string) => git.commitDetails(gitCwdOf(t, r), oid),
    },
    'git.compareUpstream': {
      args: z.tuple([id, id]),
      run: (t: string, r: string) => git.compareUpstream(gitCwdOf(t, r)),
    },
    'git.generateCommit': {
      args: z.tuple([id, id, agentSettings, z.boolean().optional()]),
      run: async (t: string, r: string, settings: AgentSettings, includeBranch?: boolean) => {
        const cwd = gitCwdOf(t, r)
        const { patch, fingerprint, files } = await lockCheckout(ctx, cwd, async () => ({
          ...(await git.stagedPatch(cwd)),
          files: await git.stagedSummary(cwd),
        }))
        const prefs = storedPreferences()
        const config = workspace.projectConfiguration(workspace.projectIdOf(t)).config.commit
        const style = config?.commitStyle ?? prefs.commitStyle ?? DEFAULT_APP_PREFERENCES.commitStyle
        const recentSubjects =
          style === 'repository'
            ? (await git.history(cwd).catch(() => [])).slice(0, 20).map((commit) => commit.subject)
            : []
        const draft = await agents.draftCommit(
          patch,
          writingSettings(workspace, prefs, settings) ?? settings,
          { style, instructions: config?.commitInstructions ?? prefs.commitInstructions ?? '', recentSubjects },
          files,
          includeBranch,
        )
        if ((await git.stagedPatch(cwd)).fingerprint !== fingerprint)
          throw new Error('Staged changes changed while generating the message. Try again.')
        return { ...draft, fingerprint }
      },
    },
    'git.init': {
      args: z.tuple([id, id]),
      run: (t: string, r: string) => {
        const binding = workspace.getBinding(t, r)
        if (!binding.notGit) throw new Error('This folder is already a Git repository')
        return lock.run(`repo:${binding.cwd}`, () => git.initRepository(binding.cwd))
      },
    },
    'git.fetch': {
      args: z.tuple([id, id]),
      run: async (t: string, r: string) => {
        await lockRepo(ctx, r, () => git.fetch(gitCwdOf(t, r)))
        remoteRefresh.fetched(repoKey(ctx, r))
      },
    },
    /**
     * A client is looking at this repository. Fetches only when it is due, then tells every client if anything moved.
     * `mayPull` is false on opening a project: looking at a checkout must not change it.
     */
    'git.refreshRemote': {
      args: z.tuple([id, id, z.boolean()]),
      run: async (t: string, r: string, mayPull: boolean) => {
        const cwd = gitCwdOf(t, r)
        const moved = await remoteRefresh.visit(repoKey(ctx, r), () => lockRepo(ctx, r, () => git.fetchCurrent(cwd)))
        if (moved === null) return false
        const pulled = mayPull && (await autoPull(t, r).catch(() => false))
        if (moved || pulled) ctx.host.send('fs:changed', { cwd, path: '.git' })
        return moved || pulled
      },
    },
    'git.autoPull': {
      args: z.tuple([id, id]),
      run: autoPull,
    },
    'git.push': {
      args: z.tuple([id, id, branchName.optional(), z.string().min(1).max(255).optional()]),
      run: (t: string, r: string, expectedBranch?: string, remote?: string) =>
        gitExclusive(ctx, t, r, async (cwd) => {
          const before = await git.status(cwd)
          await git.push(cwd, expectedBranch, remote)
          if (before.ahead > 0 || !before.upstream) followPush(t, cwd, r)
        }),
    },
    /** The remotes to choose between before publishing the branch, or null when nothing needs choosing. */
    'git.remoteChoices': {
      args: z.tuple([id, id]),
      run: (t: string, r: string) => gitExclusive(ctx, t, r, (cwd) => git.remoteChoices(cwd)),
    },
    'git.pull': {
      args: z.tuple([id, id, pullMode.optional()]),
      run: (t: string, r: string, mode?: PullMode) =>
        gitExclusive(ctx, t, r, async (cwd) => {
          assertNoActiveWriter(ctx, cwd, 'Stop the agent in this checkout before pulling.')
          return git.pull(cwd, mode ?? savedPullMode())
        }),
    },
    'git.sync': {
      args: z.tuple([id, id, z.object({ branch: branchName, oid: gitOid, targetBranch: branchName }).optional()]),
      run: (t: string, r: string, approval?: SyncApproval) =>
        gitExclusive(ctx, t, r, async (cwd) => {
          assertNoActiveWriter(ctx, cwd, 'Stop the agent in this checkout before syncing.')
          const before = await git.status(cwd)
          await git.sync(cwd, savedPullMode(), approval)
          // A sync that only pulled sent nothing of this thread's, so someone else's commit never wakes it.
          if (before.ahead > 0) followPush(t, cwd, r)
        }),
    },
    'git.continueOperation': {
      args: z.tuple([id, id]),
      run: (t: string, r: string) => gitExclusive(ctx, t, r, (cwd) => git.continueOperation(cwd)),
    },
    'git.abortOperation': {
      args: z.tuple([id, id]),
      run: (t: string, r: string) => gitExclusive(ctx, t, r, (cwd) => git.abortOperation(cwd)),
    },
    'git.checkout': {
      args: z.tuple([id, id, branchName]),
      run: (t: string, r: string, branch: string) =>
        gitExclusive(ctx, t, r, async (cwd) => {
          assertNoActiveWriter(ctx, cwd, 'Stop the agent in this checkout before switching branches.')
          return git.checkout(cwd, branch)
        }),
    },
  }
}
