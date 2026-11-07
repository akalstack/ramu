// A hosting token that expires is offered again before it runs out: a week ahead, one notice in the latest thread of
// each project that deploys with it, naming the date and where to replace it. Settings shows the date all along.
import type { InboxNotice } from '@ramu/shared/chat/notices'
import type { AccountPlatform, HostingAccount } from '@ramu/shared/types/deploy'

const DAY = 86_400_000
const WARN_BEFORE = 7 * DAY
const CHECK_EVERY = 6 * 60 * 60_000
const KEY = 'token-expiry-notices'

export interface TokenExpiryHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  /** The saved hosting accounts, without checking them against the platforms. */
  accounts(): Promise<HostingAccount[]>
  projects(): { id: string; name: string }[]
  /** The platform a project deploys to, or null without a deploy target. */
  platformOf(projectId: string): AccountPlatform | null
  latestThread(projectId: string): { taskId: string; sessionId: string } | null
  raise(notice: InboxNotice): void
}

const when = (expiresAt: number, now: number) => {
  const days = Math.ceil((expiresAt - now) / DAY)
  return days <= 1 ? 'tomorrow' : `in ${days} days`
}

export class TokenExpiryNotices {
  private running: Promise<void> | null = null
  private nextCheck = 0
  private stopping = false

  constructor(private readonly host: TokenExpiryHost) {}

  tick(now = Date.now()): Promise<void> {
    if (this.stopping || this.running || now < this.nextCheck) return this.running ?? Promise.resolve()
    this.nextCheck = now + CHECK_EVERY
    this.running = this.check(now).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async check(now: number): Promise<void> {
    const sent = this.host.getState<string[]>(KEY, [])
    const told: string[] = []
    for (const account of await this.host.accounts()) {
      if (!account.connected || !account.expiresAt || account.expiresAt - now > WARN_BEFORE) continue
      // One notice per saved token: replacing it gives a new date, which is told again when it nears.
      const key = `${account.platform}:${account.expiresAt}`
      if (sent.includes(key)) continue
      const expired = account.expiresAt <= now
      const date = new Date(account.expiresAt).toDateString()
      for (const project of this.host.projects()) {
        if (this.stopping) return
        if (this.host.platformOf(project.id) !== account.platform) continue
        const thread = this.host.latestThread(project.id)
        if (!thread) continue
        this.host.raise({
          id: `token:${account.platform}:${project.id}`,
          taskId: thread.taskId,
          sessionId: thread.sessionId,
          kind: 'usage',
          title: expired
            ? `${account.name} token has expired`
            : `${account.name} token expires ${when(account.expiresAt, now)}`,
          body: `The ${account.name} token Ramu deploys ${project.name} with ${expired ? 'stopped' : 'stops'} working on ${date}. Make a new one and choose Replace in Settings → Git → Hosting accounts, so deploys keep working.`,
          at: now,
        })
      }
      told.push(key)
    }
    if (told.length) this.host.setState(KEY, [...told, ...sent].slice(0, 50))
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.running
  }
}
