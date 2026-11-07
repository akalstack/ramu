// Generated files proposed as one pull request, committed in a throwaway worktree from the fetched default branch so
// the person's checkout, branch and uncommitted work are never touched. Set up CI, the store release's eas.json and
// the own server's Dockerfile and deploy job use it.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createPullRequest } from './forge'
import { branchExists, commitBranchInfo, fetchedBranch, git, publishRemote } from './git'

export interface ProposedFile {
  /** Relative to the repository root. */
  path: string
  content: string
}

export interface ProposedChange {
  /** None means there is nothing to add, and no branch or pull request is made. */
  files: ProposedFile[]
  /** The commit message. */
  commit: string
  title: string
  body: string
}

/** A branch name free both here and on the remote, so an earlier attempt is never overwritten. */
async function freeBranch(root: string, remote: string, base: string): Promise<string> {
  for (let n = 1; n <= 20; n++) {
    const name = n === 1 ? base : `${base}-${n}`
    if (await branchExists(root, name)) continue
    const listed = await git(root, ['ls-remote', '--heads', remote, `refs/heads/${name}`])
    if (!listed.trim()) return name
  }
  throw new Error(`Delete the older ${base} branches before trying again.`)
}

/** Whether `path` exists in the commit `ref`. */
export const existsAt = (root: string, ref: string, path: string) =>
  git(root, ['cat-file', '-e', `${ref}:${path}`]).then(
    () => true,
    () => false,
  )

/**
 * Commits the files `make` returns on a new branch named after `branch`, pushes it and opens a pull request into the
 * default branch. `make` reads the fetched default branch (`ref`) and may refuse. The repository's hooks are switched
 * off: they expect installed dependencies, and the change is generated files the person reviews in the pull request.
 * A failed push is passed to `pushFailure` for a message the person can act on.
 */
export async function proposeFile(
  root: string,
  branch: string,
  make: (ref: string, defaultBranch: string) => Promise<ProposedChange>,
  pushFailure: (error: unknown) => Error = (error) =>
    new Error('The branch could not be pushed. Check that this host can push to the repository.', { cause: error }),
): Promise<{ url: string | null; change: ProposedChange; defaultBranch: string }> {
  const defaultBranch = (await commitBranchInfo(root)).defaultBranch ?? 'main'
  const { remote } = await publishRemote(root, defaultBranch)
  if (!remote) throw new Error('This repository has no remote to open a pull request on.')
  const { ref } = await fetchedBranch(root, defaultBranch)
  const change = await make(ref, defaultBranch)
  if (!change.files.length) return { url: null, change, defaultBranch }
  for (const file of change.files)
    if (await existsAt(root, ref, file.path))
      throw new Error(`${defaultBranch} already has ${file.path}. Ask an agent to change it instead.`)
  const name = await freeBranch(root, remote, branch)
  const scratch = await mkdtemp(join(tmpdir(), 'ramu-propose-'))
  const hooks = join(scratch, 'hooks')
  const tree = join(scratch, 'tree')
  const quiet = ['-c', `core.hooksPath=${hooks}`]
  await mkdir(hooks)
  let added = false
  try {
    await git(root, [...quiet, 'worktree', 'add', '--no-track', '-b', name, '--', tree, ref])
    added = true
    for (const file of change.files) {
      await mkdir(dirname(join(tree, file.path)), { recursive: true })
      await writeFile(join(tree, file.path), file.content)
    }
    await git(tree, ['add', '--', ...change.files.map((file) => file.path)])
    await git(tree, [...quiet, 'commit', '--file=-'], { input: change.commit })
    await git(tree, [...quiet, 'push', '--set-upstream', remote, name]).catch((error: unknown) => {
      throw pushFailure(error)
    })
    const status = await createPullRequest(tree, {
      title: change.title,
      body: change.body,
      base: defaultBranch,
      draft: false,
    })
    return { url: status.pullRequest?.url ?? null, change, defaultBranch }
  } finally {
    if (added) {
      await git(root, ['worktree', 'remove', '--force', '--', tree]).catch(() => undefined)
      // The branch lives on the remote now; the local copy only clutters the branch list.
      await git(root, ['branch', '-D', name]).catch(() => undefined)
    }
    await rm(scratch, { recursive: true, force: true })
  }
}
