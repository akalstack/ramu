// After a thread's checkout pushes, Ramu follows what the push sets off: CI on the default branch, and the platform's
// production deployment of that branch or preview deployment of another. Either can wake the thread.
import type { PullRequestWatchService } from '../background/pullRequestWatches'
import type { Deploys } from './deploy/deploys'
import { commitBranchInfo, headOid } from './git'

export function followPush(
  services: { pullRequestWatches?: Pick<PullRequestWatchService, 'watchPush'>; deploys?: Pick<Deploys, 'pushed'> },
  taskId: string,
  cwd: string,
  repoId: string,
): void {
  void services.pullRequestWatches?.watchPush(taskId, cwd, repoId).catch((error: unknown) => {
    console.error('Could not follow the push:', error)
  })
  const deploys = services.deploys
  if (deploys)
    void (async () => {
      const { branch } = await commitBranchInfo(cwd)
      const sha = await headOid(cwd)
      if (branch && sha) await deploys.pushed(repoId, branch, sha, taskId)
    })().catch((error: unknown) => {
      console.error('Could not follow the deployment of the push:', error)
    })
}
