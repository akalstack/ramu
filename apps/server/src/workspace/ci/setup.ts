// Set up CI: the workflow for a repository from what its default branch holds, opened as a pull request from a
// throwaway worktree so the person's checkout, branch and uncommitted work are never touched.
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CI_MANIFESTS,
  ciWorkflow,
  type CiFacts,
  type CiForge,
  type CiPreview,
  type CiProtection,
  type CiSetupResult,
  type CiWorkflow,
  CI_CHECK,
} from '@ramu/shared/ciWorkflow'
import { createPullRequest, forgeRemoteOf, requireCheck } from '../forge'
import { kindOfOrigin } from '../forge/route'
import { branchExists, commitBranchInfo, fetchedBranch, git, publishRemote } from '../git'
import { loadProjectConfig } from '../projectConfig'

/** Manifests larger than this are not read; a real package.json or Gemfile is far smaller. */
const MANIFEST_LIMIT = 256 * 1024
const BRANCH = 'ramu/set-up-ci'

type Facts = Omit<CiFacts, 'defaultBranch' | 'stack'>

/** The forge whose CI file fits this repository; one without a remote gets GitHub Actions, the common case. */
async function forgeOf(root: string, remoteRequired: boolean): Promise<CiForge> {
  const remote = await forgeRemoteOf(root)
  if (!remote) {
    if (remoteRequired) throw new Error('Publish this repository to GitHub or GitLab before setting up CI.')
    return 'github'
  }
  const kind = await kindOfOrigin(remote.origin)
  if (kind !== 'github' && kind !== 'gitlab')
    throw new Error(
      'Set up CI writes GitHub Actions or GitLab CI; set up pipelines for this repository on its own site.',
    )
  return kind
}

function stackOf(root: string): CiFacts['stack'] {
  const stack = loadProjectConfig(root).config.stack
  return { ...(stack?.build ? { build: stack.build } : {}), ...(stack?.test ? { test: stack.test } : {}) }
}

function generated(forge: CiForge, facts: CiFacts): CiWorkflow {
  const workflow = ciWorkflow(forge, facts)
  if (!workflow)
    throw new Error(
      'No lockfile or manifest Ramu knows is at the repository root (package.json, pyproject.toml, requirements.txt, Gemfile or go.mod).',
    )
  return workflow
}

/** The root of a commit, read through Git so nothing is checked out. */
async function factsAt(root: string, ref: string): Promise<Facts> {
  const files = (await git(root, ['ls-tree', '--name-only', ref])).split('\n').filter(Boolean)
  const manifests: Facts['manifests'] = {}
  for (const name of CI_MANIFESTS) {
    if (!files.includes(name)) continue
    const size = Number((await git(root, ['cat-file', '-s', `${ref}:${name}`]).catch(() => '')).trim())
    if (!size || size > MANIFEST_LIMIT) continue
    manifests[name] = await git(root, ['cat-file', 'blob', `${ref}:${name}`])
  }
  return { files, manifests }
}

/** The root of a working tree, including files not committed yet. Links are not followed out of it. */
async function factsIn(root: string): Promise<Facts> {
  const files = await readdir(root)
  const manifests: Facts['manifests'] = {}
  for (const name of CI_MANIFESTS) {
    if (!files.includes(name)) continue
    const info = await lstat(join(root, name))
    if (info.isFile() && info.size <= MANIFEST_LIMIT) manifests[name] = await readFile(join(root, name), 'utf8')
  }
  return { files, manifests }
}

const existsAt = (root: string, ref: string, path: string) =>
  git(root, ['cat-file', '-e', `${ref}:${path}`]).then(
    () => true,
    () => false,
  )

/** App state listing the repositories Ramu created on a forge, where requiring CI breaks no one's habits. */
export const CREATED_REPOSITORIES = 'created-repositories'

/** What Set up CI would add, read from the last fetched default branch without asking the network. */
export async function ciPreview(root: string): Promise<Omit<CiPreview, 'requireByDefault'>> {
  const forge = await forgeOf(root, true)
  const defaultBranch = (await commitBranchInfo(root)).defaultBranch ?? 'main'
  const { remote } = await publishRemote(root, defaultBranch)
  const tracked = remote ? `refs/remotes/${remote}/${defaultBranch}` : null
  const ref = tracked && (await existsAt(root, tracked, '')) ? tracked : 'HEAD'
  const workflow = generated(forge, { ...(await factsAt(root, ref)), defaultBranch, stack: stackOf(root) })
  return {
    forge,
    path: workflow.path,
    toolchain: workflow.toolchain,
    steps: workflow.steps,
    defaultBranch,
    exists: await existsAt(root, ref, workflow.path),
  }
}

/** A branch name free both here and on the remote, so an earlier attempt is never overwritten. */
async function freeBranch(root: string, remote: string): Promise<string> {
  for (let n = 1; n <= 20; n++) {
    const name = n === 1 ? BRANCH : `${BRANCH}-${n}`
    if (await branchExists(root, name)) continue
    const listed = await git(root, ['ls-remote', '--heads', remote, `refs/heads/${name}`])
    if (!listed.trim()) return name
  }
  throw new Error('Delete the older ramu/set-up-ci branches before setting up CI again.')
}

/** Git refuses workflow files pushed with a token that lacks the workflow scope; say how to grant it. */
function pushFailure(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error)
  if (/workflow.*scope|without `?workflow`? scope/i.test(text))
    return new Error(
      'GitHub refused the workflow file: the Git sign-in on this host lacks the workflow permission. Run gh auth refresh -s workflow, or give your token the Workflows permission, then try again.',
      { cause: error },
    )
  return new Error('The CI branch could not be pushed. Check that this host can push to the repository.', {
    cause: error,
  })
}

/**
 * Commits the workflow on a new branch from the fetched default branch and opens a pull request for it. The commit
 * is made in a temporary worktree with the repository's hooks switched off: they expect installed dependencies, and the
 * change is one generated file the person reviews in the pull request.
 */
export async function setUpCi(root: string, requireCi: boolean): Promise<CiSetupResult> {
  const forge = await forgeOf(root, true)
  const defaultBranch = (await commitBranchInfo(root)).defaultBranch ?? 'main'
  const { remote } = await publishRemote(root, defaultBranch)
  if (!remote) throw new Error('This repository has no remote to open a pull request on.')
  const { ref } = await fetchedBranch(root, defaultBranch)
  const workflow = generated(forge, { ...(await factsAt(root, ref)), defaultBranch, stack: stackOf(root) })
  if (await existsAt(root, ref, workflow.path))
    throw new Error(`${defaultBranch} already has ${workflow.path}. Ask an agent to change it instead.`)
  const branch = await freeBranch(root, remote)
  const scratch = await mkdtemp(join(tmpdir(), 'ramu-ci-'))
  const hooks = join(scratch, 'hooks')
  const tree = join(scratch, 'tree')
  const quiet = ['-c', `core.hooksPath=${hooks}`]
  await mkdir(hooks)
  let added = false
  try {
    await git(root, [...quiet, 'worktree', 'add', '--no-track', '-b', branch, '--', tree, ref])
    added = true
    await mkdir(dirname(join(tree, workflow.path)), { recursive: true })
    await writeFile(join(tree, workflow.path), workflow.content)
    await git(tree, ['add', '--', workflow.path])
    await git(tree, [...quiet, 'commit', '--file=-'], {
      input: `ci: set up CI\n\nInstall with ${workflow.toolchain}, then ${workflow.steps.map((step) => step.name.toLowerCase()).join(', ') || 'install only'}.\n`,
    })
    await git(tree, [...quiet, 'push', '--set-upstream', remote, branch]).catch((error: unknown) => {
      throw pushFailure(error)
    })
    const status = await createPullRequest(tree, {
      title: 'Set up CI',
      body: [
        `Adds \`${workflow.path}\`: it installs with ${workflow.toolchain} (cached) and runs ${
          workflow.steps.map((step) => `\`${step.run}\``).join(', ') || 'the install only'
        } on pull requests and pushes to \`${defaultBranch}\`.`,
        'Generated by Ramu from the repository’s lockfile and scripts. Monorepo filters and services such as a database for tests may need adding.',
      ].join('\n\n'),
      base: defaultBranch,
      draft: false,
    })
    return {
      url: status.pullRequest?.url ?? null,
      path: workflow.path,
      protection: requireCi ? await protect(root, forge, defaultBranch) : null,
    }
  } finally {
    if (added) {
      await git(root, ['worktree', 'remove', '--force', '--', tree]).catch(() => undefined)
      // The branch lives on the remote now; the local copy only clutters the branch list.
      await git(root, ['branch', '-D', branch]).catch(() => undefined)
    }
    await rm(scratch, { recursive: true, force: true })
  }
}

/** Requires the CI check before merging. The pull request is already open, so a refusal is reported, not thrown. */
async function protect(root: string, forge: CiForge, branch: string): Promise<CiProtection> {
  if (forge !== 'github') return { state: 'unsupported' }
  try {
    return { state: await requireCheck(root, branch, CI_CHECK) }
  } catch (error) {
    return { state: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The workflow for an agent's checkout, written there unless the file exists already. The agent reviews it before
 * committing, so files that are not committed yet count.
 */
export async function draftCi(
  checkout: string,
): Promise<{ workflow: CiWorkflow; written: boolean; existing: string | null }> {
  const root = (await git(checkout, ['rev-parse', '--show-toplevel'])).trim()
  const forge = await forgeOf(root, false)
  const defaultBranch = (await commitBranchInfo(root)).defaultBranch ?? 'main'
  const workflow = generated(forge, { ...(await factsIn(root)), defaultBranch, stack: stackOf(root) })
  const target = join(root, workflow.path)
  const existing = await readFile(target, 'utf8').catch(() => null)
  if (existing !== null) return { workflow, written: false, existing: existing.slice(0, 20_000) }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, workflow.content, { flag: 'wx' })
  return { workflow, written: true, existing: null }
}
