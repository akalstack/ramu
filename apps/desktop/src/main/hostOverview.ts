import type { HostOverview } from '@ramu/shared/hostOverview'

/** Reads one explicit endpoint. A failed section cannot hide successful sections or fall back to another host. */
export async function readHostOverview(invoke: (method: string) => Promise<unknown>): Promise<HostOverview> {
  const result: HostOverview = { projects: [], tasks: [], agents: [], summaries: [], errors: [] }
  const reads = [
    ['projects', () => invoke('projects.list')],
    ['tasks', () => invoke('tasks.list')],
    ['agents', () => invoke('agent.all')],
    ['summaries', async () => ((await invoke('summaries.get')) as { summaries: unknown }).summaries],
  ] as const
  await Promise.all(
    reads.map(async ([key, read]) => {
      try {
        const value = await read()
        if (!Array.isArray(value)) throw new Error('Invalid host response')
        Object.assign(result, { [key]: value })
      } catch (error) {
        result.errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
  )
  // Owner-only, so a viewer's refusal is expected and is not a host problem.
  result.resources = await (invoke('resources.host') as Promise<HostOverview['resources']>).catch(() => null)
  return result
}

/** A large host list cannot flood all servers at once. Sidebar and inbox reads of a host join the same request. */
export class HostOverviewQueue {
  private active = 0
  private readonly waiting: (() => void)[] = []
  private readonly pending = new Map<string, Promise<HostOverview>>()
  constructor(
    private readonly load: (id: string) => Promise<HostOverview>,
    private readonly concurrency = 3,
  ) {}
  read(id: string): Promise<HostOverview> {
    const previous = this.pending.get(id)
    if (previous) return previous
    const request = new Promise<HostOverview>((resolve, reject) => {
      const run = () => {
        this.active++
        void this.load(id)
          .then(resolve, reject)
          .finally(() => {
            this.pending.delete(id)
            this.active--
            this.waiting.shift()?.()
          })
      }
      if (this.active < this.concurrency) run()
      else this.waiting.push(run)
    })
    this.pending.set(id, request)
    return request
  }
}
