import { rm } from 'node:fs/promises'
import { z } from 'zod'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type { AgentSettings, CommitBranchOptions, DiffContents, PullMode } from '@ramu/shared/types'
import { discardPreview } from '../../workspace/discardPreview'
import * as files from '../../workspace/files'
import * as git from '../../workspace/git'
import { assertNoActiveWriter, gitExclusive, lockCheckout, lockRepo } from '../helpers'
import { agentSettings, fingerprintHash, gitOid, id, pullMode, relPath } from '../schemas'
import type { RegisterHandlers } from '../types'

const branchName = z.string().min(1).max(200)
const stagedPaths = z.array(relPath).max(10_000)
const discardPaths = z.array(relPath).min(1).max(10_000)

/** Git status, staging, commits, branches, stashes and remote sync for a task's repository. */
export const registerGitHandlers: RegisterHandlers = (ctx) => {
  const { workspace, agents, lock, gitCwdOf, loadPreferences, storedPreferences } = ctx
  /** Pull and Sync follow the saved preference, so every entry point integrates the same way. */
  const savedPullMode = (): PullMode => storedPreferences().pullMode ?? DEFAULT_APP_PREFERENCES.pullMode

  return {
    'git.status': {
      args: z.tuple([id, id]),
      run: (taskId: string, repoId: string) => git.status(gitCwdOf(taskId, repoId)),
    },
    'git.diff': {
      args: z.tuple([id, id, relPath, z.boolean()]),
      run: async (taskId: string, repoId: string, path: string, staged: boolean): Promise<DiffContents> => {
        const cwd = gitCwdOf(taskId, repoId)
        await files.resolveInRoot(cwd, path)
        if (staged)
          return { original: await git.showBlob(cwd, 'HEAD', path), modified: await git.showBlob(cwd, 'INDEX', path) }
        const working = await files.readText(cwd, path).then(
          (f) => f.content,
          () => '',
        )
        return { original: await git.showBlob(cwd, 'INDEX', path), modified: working }
      },
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
          return git.commit(cwd, message, amendHead, branchOptions)
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
        const style = prefs.commitStyle ?? DEFAULT_APP_PREFERENCES.commitStyle
        const recentSubjects =
          style === 'repository'
            ? (await git.history(cwd).catch(() => [])).slice(0, 20).map((commit) => commit.subject)
            : []
        const draft = await agents.draftCommit(
          patch,
          settings,
          { style, instructions: prefs.commitInstructions ?? '', recentSubjects },
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
      run: (t: string, r: string) => lockRepo(ctx, r, () => git.fetch(gitCwdOf(t, r))),
    },
    'git.autoPull': {
      args: z.tuple([id, id]),
      run: (t: string, r: string) =>
        gitExclusive(ctx, t, r, async (cwd) => {
          if (!loadPreferences().autoPull || agents.activeWriter([cwd])) return false
          return git.autoPull(cwd)
        }),
    },
    'git.push': {
      args: z.tuple([id, id, branchName.optional()]),
      run: (t: string, r: string, expectedBranch?: string) =>
        gitExclusive(ctx, t, r, (cwd) => git.push(cwd, expectedBranch)),
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
      args: z.tuple([id, id]),
      run: (t: string, r: string) =>
        gitExclusive(ctx, t, r, async (cwd) => {
          assertNoActiveWriter(ctx, cwd, 'Stop the agent in this checkout before syncing.')
          return git.sync(cwd, savedPullMode())
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
