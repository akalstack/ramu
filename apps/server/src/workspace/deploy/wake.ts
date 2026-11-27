// Handing a deploy event to a thread through its durable queue, the way pull request and push watches hand over CI
// failures: the message waits while the thread is busy and survives a restart.
import type { AgentService } from '../../agent'
import type { Db } from '../../db'
import type { MessageOrigin } from '@ramu/shared/types'
import { currentBranch } from '../git'
import type { Workspace } from '../workspace'

export class ProjectWake {
  constructor(
    private readonly db: Pick<Db, 'exec'>,
    private readonly workspace: Pick<Workspace, 'getTask' | 'listTasks'>,
    private readonly agents: Pick<AgentService, 'get' | 'list' | 'enqueueBackground'>,
  ) {}

  /** The project's most recently active thread that can still take a message. */
  latestThread(projectId: string): string | null {
    for (const task of this.workspace
      .listTasks()
      .filter((entry) => entry.projectId === projectId && entry.status !== 'archived')
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)) {
      const session = this.agents.list(task.id).findLast((entry) => !entry.parentId && entry.state !== 'stopped')
      if (session) return session.id
    }
    return null
  }

  /**
   * Queues `text` for a thread that is still open, together with `alsoCommit` in one database transaction, so a
   * restart cannot deliver the same event twice. Returns false when the thread can no longer take it.
   */
  async send(
    sessionId: string | null,
    text: string,
    from: MessageOrigin,
    alsoCommit: () => void = () => {},
  ): Promise<boolean> {
    const session = sessionId ? this.open(sessionId) : null
    const branch = session ? await currentBranch(session.cwd) : null
    if (!session || !branch) return false
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.agents.enqueueBackground(session.id, text, { cwd: session.cwd, branch }, from)
      alsoCommit()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return true
  }

  private open(sessionId: string) {
    try {
      const session = this.agents.get(sessionId)
      if (session.state === 'stopped' || this.workspace.getTask(session.taskId).status === 'archived') return null
      return session
    } catch {
      return null
    }
  }
}
