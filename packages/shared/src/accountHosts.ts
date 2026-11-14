// Adding the hosts a person listed in their Ramu account without a tap, on any device signed in to it. Only hosts that
// let the account's devices in are added, and each only once: a host forgotten on this device stays forgotten until
// the person adds it again. A host that asks first waits for the person to choose Add this host or Pair.
import type { ListedHostInfo } from './account'

/** After a failed try, the same host is tried again only after this long, so a host that is off is not asked often. */
export const ACCOUNT_HOST_RETRY_MS = 10 * 60_000

export class AccountHostConnector {
  private running: Promise<string[]> | null = null
  private readonly failed = new Map<string, number>()
  constructor(
    private readonly options: {
      hosts: () => Promise<ListedHostInfo[]>
      /** Whether this device already has the host, by the host's id. */
      saved: (hostKey: string) => boolean
      /** Listed hosts this device added on its own before, kept across launches. */
      added: { has(id: string): boolean; add(id: string): void }
      pair: (host: ListedHostInfo) => Promise<void>
      now?: () => number
    },
  ) {}

  /** Pairs every listed host that lets this account in and is not here yet; resolves with the names it added. */
  connect(): Promise<string[]> {
    this.running ??= this.run().finally(() => (this.running = null))
    return this.running
  }

  private async run(): Promise<string[]> {
    const now = this.options.now?.() ?? Date.now()
    const hosts = await this.options.hosts().catch(() => [] as ListedHostInfo[])
    const added: string[] = []
    for (const host of hosts) {
      if (host.trust === 'ask' || this.options.added.has(host.id) || this.options.saved(host.hostKey)) continue
      if ((this.failed.get(host.id) ?? 0) > now) continue
      try {
        await this.options.pair(host)
        this.options.added.add(host.id)
        this.failed.delete(host.id)
        added.push(host.name)
      } catch {
        this.failed.set(host.id, now + ACCOUNT_HOST_RETRY_MS)
      }
    }
    return added
  }
}
