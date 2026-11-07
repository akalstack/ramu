// Set up CI: the workflow for a repository from what its default branch holds, opened as a pull request from a
// throwaway worktree so the person's checkout, branch and uncommitted work are never touched.
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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
import { forgeRemoteOf, requireCheck } from '../forge'
import { kindOfOrigin } from '../forge/route'
import { commitBranchInfo, git, publishRemote } from '../git'
import { existsAt, proposeFile } from '../proposeFile'
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

/** The root of a commit and the contents of the named files there, read through Git so nothing is checked out. */
export async function factsAt<Name extends string = (typeof CI_MANIFESTS)[number]>(
  root: string,
  ref: string,
  names: readonly Name[] = CI_MANIFESTS as readonly string[] as readonly Name[],
): Promise<{ files: string[]; manifests: Partial<Record<Name, string>> }> {
  const files = (await git(root, ['ls-tree', '--name-only', ref])).split('\n').filter(Boolean)
  const manifests: Partial<Record<Name, string>> = {}
  for (const name of names) {
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

/** Commits the workflow on a new branch from the fetched default branch and opens a pull request for it. */
export async function setUpCi(root: string, requireCi: boolean): Promise<CiSetupResult> {
  const forge = await forgeOf(root, true)
  const { url, change, defaultBranch } = await proposeFile(
    root,
    BRANCH,
    async (ref, defaultBranch) => {
      const workflow = generated(forge, { ...(await factsAt(root, ref)), defaultBranch, stack: stackOf(root) })
      return {
        files: [{ path: workflow.path, content: workflow.content }],
        commit: `ci: set up CI\n\nInstall with ${workflow.toolchain}, then ${workflow.steps.map((step) => step.name.toLowerCase()).join(', ') || 'install only'}.\n`,
        title: 'Set up CI',
        body: [
          `Adds \`${workflow.path}\`: it installs with ${workflow.toolchain} (cached) and runs ${
            workflow.steps.map((step) => `\`${step.run}\``).join(', ') || 'the install only'
          } on pull requests and pushes to \`${defaultBranch}\`.`,
          'Generated by Ramu from the repository’s lockfile and scripts. Monorepo filters and services such as a database for tests may need adding.',
        ].join('\n\n'),
      }
    },
    pushFailure,
  )
  return { url, path: change.files[0]!.path, protection: requireCi ? await protect(root, forge, defaultBranch) : null }
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
