// The latest deploy of a project, as its Git host reports it. Platforms connected to a repository (Vercel, Netlify,
// Railway, Cloudflare, Render, GitHub Pages) post each deploy on the commit as a check or a commit status, so the checks
// on the default branch's newest commit show the latest deploy of any platform without code of Ramu's for it.
import type { DeployChecks } from '@ramu/shared/types/deploy'
import { commitChecks } from '../forge'
import { commitBranchInfo, git } from '../git'

const SHA = /^[0-9a-f]{40,64}$/

/** The checks on the newest commit of a checkout's default branch on its remote, or null when they cannot be read. */
export async function latestDeployChecks(repository: {
  id: string
  name: string
  root: string
}): Promise<DeployChecks | null> {
  const { defaultBranch } = await commitBranchInfo(repository.root)
  if (!defaultBranch) return null
  // The remote's commit, not the checkout's: the platform deploys what was pushed.
  const listed = await git(repository.root, ['ls-remote', '--heads', 'origin', `refs/heads/${defaultBranch}`]).catch(
    () => '',
  )
  const commit = listed.split(/\s/)[0] ?? ''
  if (!SHA.test(commit)) return null
  const checks = await commitChecks(repository.root, commit).catch(() => null)
  if (!checks) return null
  return { repoId: repository.id, name: repository.name, branch: defaultBranch, commit, checks }
}
