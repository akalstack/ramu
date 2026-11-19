import { randomUUID } from 'node:crypto'
import type { BackgroundActivity } from '@ramu/shared/chat/activity'

export class ActivityService {
  private cancellations = new Map<string, () => void>()
  private active = new Map<string, BackgroundActivity>()
  constructor(private changed: (activities: BackgroundActivity[]) => void) {}
  status(): BackgroundActivity[] {
    return [...this.active.values()]
  }
  cancel(id: string): void {
    const cancel = this.cancellations.get(id)
    if (!cancel) throw new Error('This background activity cannot be stopped.')
    cancel()
  }
  async run<T>(label: string, detail: string | undefined, work: () => T | Promise<T>, cancel?: () => void): Promise<T> {
    const id = randomUUID()
    this.active.set(id, { id, label, ...(detail ? { detail } : {}), ...(cancel ? { cancellable: true } : {}) })
    if (cancel) this.cancellations.set(id, cancel)
    this.changed(this.status())
    try {
      return await work()
    } finally {
      this.cancellations.delete(id)
      this.active.delete(id)
      this.changed(this.status())
    }
  }
}

/** Reads and frequent file queries stay quiet; potentially long operations are explicit. */
export const operationLabels: Record<string, string> = {
  'git.fetch': 'Fetching repositories',
  'git.autoPull': 'Pulling repository updates',
  'git.pull': 'Pulling repository updates',
  'git.push': 'Pushing repository changes',
  'forge.createPullRequest': 'Opening pull request',
  'forge.publishRepository': 'Publishing repository',
  'forge.pullRequestFeedback': 'Collecting pull request feedback',
  'git.sync': 'Syncing repositories',
  'git.checkout': 'Switching branches',
  'git.commit': 'Committing changes',
  'git.generateCommit': 'Generating commit message',
  'git.createBranch': 'Creating branch',
  'git.createBranchFrom': 'Creating branch',
  'git.renameBranch': 'Renaming branch',
  'git.mergeBranch': 'Merging branch',
  'git.deleteBranch': 'Deleting branch',
  'git.init': 'Initializing repository',
  'git.stage': 'Staging changes',
  'git.unstage': 'Unstaging changes',
  'git.discard': 'Discarding changes',
  'git.stash': 'Stashing changes',
  'git.popStash': 'Restoring stash',
  'git.applyStash': 'Applying stash',
  'git.dropStash': 'Deleting stash',
  'git.undoCommit': 'Undoing commit',
  'git.continueOperation': 'Continuing Git operation',
  'git.abortOperation': 'Aborting Git operation',
  'tasks.setup': 'Setting up checkout',
  'tasks.delete': 'Removing thread',
  'usage.refresh': 'Refreshing usage limits',
  'files.replaceApply': 'Replacing files',
}
