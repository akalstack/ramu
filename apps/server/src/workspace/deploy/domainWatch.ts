// Following a newly added domain until it serves the app over HTTPS, then waking a thread once through its durable
// queue, the same way pull request and push watches hand over CI failures.
import { randomUUID } from 'node:crypto'
import type { AgentService } from '../../agent'
import type { Db } from '../../db'
import { currentBranch } from '../git'
import type { Workspace } from '../workspace'
import type { DeployService } from './service'

const KEY = 'domain-watches'
const INTERVAL = 60_000
/** DNS changes can take up to two days to reach everyone; a domain still not live after three is left to the person. */
const TTL = 72 * 60 * 60_000

interface DomainWatch {
  id: string
  projectId: string
  name: string
  /** The thread woken when the domain is live: the one that added it, or the project's latest thread. */
  sessionId: string | null
  since: number
}

export class DomainWatches {
  private running: Promise<void> | null = null
  private nextPoll = 0
  private stopping = false

  constructor(
    private readonly db: Pick<Db, 'exec'>,
    private readonly workspace: Pick<Workspace, 'getAppState' | 'setAppState' | 'getTask' | 'listTasks'>,
    private readonly agents: Pick<AgentService, 'get' | 'list' | 'enqueueBackground'>,
    private readonly service: Pick<DeployService, 'domains'>,
  ) {}

  private list(): DomainWatch[] {
    return this.workspace.getAppState<DomainWatch[]>(KEY, [])
  }

  private remove(id: string): void {
    this.workspace.setAppState(
      KEY,
      this.list().filter((watch) => watch.id !== id),
    )
  }

  /** The project's most recently active thread that can still take a message. */
  private latestThread(projectId: string): string | null {
    for (const task of this.workspace
      .listTasks()
      .filter((entry) => entry.projectId === projectId && entry.status !== 'archived')
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)) {
      const session = this.agents.list(task.id).findLast((entry) => !entry.parentId && entry.state !== 'stopped')
      if (session) return session.id
    }
    return null
  }

  /** Follows one domain of a project; watching it again replaces the earlier watch. */
  watch(projectId: string, name: string, sessionId: string | null): void {
    const watch: DomainWatch = {
      id: randomUUID(),
      projectId,
      name,
      sessionId: sessionId ?? this.latestThread(projectId),
      since: Date.now(),
    }
    this.workspace.setAppState(KEY, [
      ...this.list().filter((entry) => entry.projectId !== projectId || entry.name !== name),
      watch,
    ])
    this.nextPoll = 0
  }

  tick(now = Date.now()): Promise<void> {
    if (this.stopping || this.running || now < this.nextPoll || !this.list().length)
      return this.running ?? Promise.resolve()
    this.nextPoll = now + INTERVAL
    this.running = this.poll(now).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async poll(now: number): Promise<void> {
    // One read per project, however many of its domains are followed.
    const read = new Map<string, ReturnType<DeployService['domains']>>()
    for (const watch of this.list()) {
      if (this.stopping) return
      if (now - watch.since > TTL) {
        this.remove(watch.id)
        continue
      }
      try {
        let pending = read.get(watch.projectId)
        if (!pending) read.set(watch.projectId, (pending = this.service.domains(watch.projectId)))
        const domain = (await pending).find((entry) => entry.name === watch.name)
        // Removed on the platform: nothing left to follow.
        if (!domain) this.remove(watch.id)
        else if (domain.configured && domain.certificate) await this.deliver(watch)
      } catch (error) {
        // A sign-in or network failure is retried on the next poll.
        console.error('Domain watch:', watch.name, error)
      }
    }
  }

  private async session(watch: DomainWatch) {
    if (!watch.sessionId) return null
    try {
      const session = this.agents.get(watch.sessionId)
      if (session.state === 'stopped' || this.workspace.getTask(session.taskId).status === 'archived') return null
      const branch = await currentBranch(session.cwd)
      return branch ? { id: session.id, cwd: session.cwd, branch } : null
    } catch {
      return null
    }
  }

  private async deliver(watch: DomainWatch): Promise<void> {
    const session = await this.session(watch)
    if (!session) return this.remove(watch.id)
    const text = `The custom domain ${watch.name} is live: its DNS points at the hosting platform and https://${watch.name} serves this project with a valid certificate. Tell the person in one line.`
    // Queue and removal share the database transaction, so a restart cannot announce the same domain twice.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.agents.enqueueBackground(session.id, text, { cwd: session.cwd, branch: session.branch })
      this.workspace.setAppState(
        KEY,
        this.list().filter((entry) => entry.id !== watch.id),
      )
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.running
  }
}
