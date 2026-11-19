// After a thread's checkout pushes, Ramu follows the checks on the pushed commit: CI and the deploys hosting platforms
// report there. When they finish, the thread is woken once with the result.
import type { PullRequestWatchService } from '../background/pullRequestWatches'

export function followPush(
  pullRequestWatches: Pick<PullRequestWatchService, 'watchPush'> | undefined,
  taskId: string,
  cwd: string,
  repoId: string,
): void {
  void pullRequestWatches?.watchPush(taskId, cwd, repoId).catch((error: unknown) => {
    console.error('Could not follow the push:', error)
  })
}
