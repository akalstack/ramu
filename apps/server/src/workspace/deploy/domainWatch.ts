// Following a newly added domain until it serves the app over HTTPS, then waking a thread once through its durable
// queue, the same way pull request and push watches hand over CI failures.
import { randomUUID } from 'node:crypto'
import type { Workspace } from '../workspace'
import type { DeployService } from './service'
import type { ProjectWake } from './wake'

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
    private readonly workspace: Pick<Workspace, 'getAppState' | 'setAppState'>,
    private readonly wake: Pick<ProjectWake, 'latestThread' | 'send'>,
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

  /** Follows one domain of a project; watching it again replaces the earlier watch. */
  watch(projectId: string, name: string, sessionId: string | null): void {
    const watch: DomainWatch = {
      id: randomUUID(),
      projectId,
      name,
      sessionId: sessionId ?? this.wake.latestThread(projectId),
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

  private async deliver(watch: DomainWatch): Promise<void> {
    const text = `The custom domain ${watch.name} is live: its DNS points at the hosting platform and https://${watch.name} serves this project with a valid certificate. Tell the person in one line.`
    const sent = await this.wake.send(watch.sessionId, text, () =>
      this.workspace.setAppState(
        KEY,
        this.list().filter((entry) => entry.id !== watch.id),
      ),
    )
    if (!sent) this.remove(watch.id)
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.running
  }
}
