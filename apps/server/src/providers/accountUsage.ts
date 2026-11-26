import type { AgentProvider, UsageReading } from '@ramu/shared/types'
import { providerAccountOrder, providerEnabled, type ProviderConfiguration } from '@ramu/shared/providers/providers'

/** Reads one login's plan usage; null when the provider has no way to read it. */
export type AccountUsageReader = (accountId: string) => Promise<UsageReading[]>
export const ACCOUNT_USAGE_INTERVAL_MS = 5 * 60_000

/**
 * Keeps the plan usage of every login fresh for providers where "use all accounts" is on, so Ramu knows which
 * account has room before it needs one. Reads are on demand (the gauges' existing refresh, and just before an
 * account switch) and throttled per login; the server also calls it on a timer.
 * Providers in `standalone` are read even with a single login, because their own reading only arrives while they run.
 */
export class AccountUsage {
  private last = new Map<string, number>()
  constructor(
    private readonly update: (readings: UsageReading[]) => void,
    private readonly config: () => ProviderConfiguration,
    private readonly readers: Partial<Record<AgentProvider, AccountUsageReader>>,
    private readonly standalone: AgentProvider[] = [],
  ) {}

  /** Lets the next refresh read this login at once, as after a plan change. */
  forget(provider: AgentProvider, accountId: string): void {
    this.last.delete(`${provider}:${accountId}`)
  }

  /** Lets the next refresh read every login at once, as after logins, keys or enabled providers change. */
  forgetAll(): void {
    this.last.clear()
  }

  async refresh(only?: AgentProvider, now = Date.now()): Promise<void> {
    const config = this.config()
    const jobs: Promise<void>[] = []
    for (const [provider, read] of Object.entries(this.readers) as [AgentProvider, AccountUsageReader][]) {
      if ((only && provider !== only) || !providerEnabled(config, provider)) continue
      const accounts = providerAccountOrder(config, provider)
      const single = this.standalone.includes(provider)
      // A single account is already covered by the provider's own usage reading, unless that only updates while it runs.
      if (accounts.length < 2 && !single) continue
      const order = accounts.length ? accounts : ['default']
      for (const account of order) {
        const key = `${provider}:${account}`
        if (now - (this.last.get(key) ?? 0) < ACCOUNT_USAGE_INTERVAL_MS) continue
        this.last.set(key, now)
        jobs.push(
          read(account).then(
            (readings) => {
              const tagged = readings.map((reading) => {
                const { accountId: _ignored, ...rest } = reading
                return account === 'default' ? rest : { ...rest, accountId: account }
              })
              if (tagged.length) this.update(tagged)
            },
            () => {
              this.last.delete(key)
            },
          ),
        )
      }
    }
    await Promise.all(jobs)
  }
}
