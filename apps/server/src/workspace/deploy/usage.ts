// What a project's platforms report for the current billing period, and the Inbox notice when a figure nears the
// plan's limit. Only figures a platform's API reports are shown; a limit the API does not report is never guessed, so
// a figure without one gets no notice. Ramu never changes a plan or adds a payment method.
import type { AccountPlatform, UsageFigure, UsageReport } from '@ramu/shared/types/deploy'
import type { InboxNotice } from '@ramu/shared/chat/notices'
import { DeployError, type PlatformUsage } from './adapter'
import type { ResourceService } from './resources'
import type { DeployService } from './service'

const BILLING_PAGES: Record<AccountPlatform, string> = {
  vercel: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fsettings%2Fbilling&title=Billing',
  netlify: 'https://app.netlify.com/',
  railway: 'https://railway.com/workspace/usage',
  // Fly.io reports no usage through its API, so no report is made for it.
  fly: 'https://fly.io/dashboard/personal/billing',
  // The person's own server is billed by whoever hosts it; it reports no usage, so no report is made for it.
  server: '',
  // GitHub Pages is free for public repositories and reports no usage, so no report is made for it.
  'github-pages': '',
  cloudflare: 'https://dash.cloudflare.com/?to=/:account/billing',
  'cloudflare-workers': 'https://dash.cloudflare.com/?to=/:account/billing',
  'cloudflare-d1': 'https://dash.cloudflare.com/?to=/:account/billing',
  'cloudflare-kv': 'https://dash.cloudflare.com/?to=/:account/billing',
  'cloudflare-r2': 'https://dash.cloudflare.com/?to=/:account/billing',
  neon: 'https://console.neon.tech/app/billing',
  supabase: 'https://supabase.com/dashboard/org/_/usage',
  upstash: 'https://console.upstash.com/account/billing',
  resend: 'https://resend.com/settings/usage',
  'vercel-marketplace': 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fsettings%2Fbilling&title=Billing',
  'vercel-blob': 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fsettings%2Fbilling&title=Billing',
  'supabase-storage': 'https://supabase.com/dashboard/org/_/billing',
  // A Grafana account is read by dashboards, not billed through Ramu, so no report is made for it.
  grafana: '',
  amplitude: '',
  salesforce: '',
  expo: 'https://expo.dev/settings/billing',
}

/** One platform's report, with the reason in plain words when it has no figures for this account. */
export async function usageReport(
  platform: AccountPlatform,
  name: string,
  read: (() => Promise<PlatformUsage>) | undefined,
): Promise<UsageReport> {
  const empty = { platform, name, period: null, figures: [], billingPage: BILLING_PAGES[platform] }
  if (!read) return { ...empty, unavailable: `${name}’s API reports no usage. Open billing to see it on ${name}.` }
  try {
    const usage = await read()
    return {
      platform,
      name,
      ...usage,
      unavailable: usage.figures.length
        ? null
        : `${name}’s API reports no usage figures for this plan. Open billing to see it on ${name}.`,
    }
  } catch (error) {
    // A refusal here means the API keeps usage from this account or plan, not that something is broken.
    const refused =
      error instanceof DeployError &&
      (error.kind === 'missing-permission' || error.kind === 'not-found' || error.status === 400)
    return {
      ...empty,
      unavailable: refused
        ? `${name}’s API does not report usage for this account. Open billing to see it on ${name}.`
        : error instanceof Error
          ? error.message
          : String(error),
    }
  }
}

/** Every report for a project: its hosting platform's, then its resources'. */
export async function projectUsage(
  service: Pick<DeployService, 'usage'>,
  resources: Pick<ResourceService, 'usage'>,
  projectId: string,
): Promise<UsageReport[]> {
  const [hosting, owned] = await Promise.all([service.usage(projectId), resources.usage(projectId)])
  return [...(hosting ? [hosting] : []), ...owned]
}

const CHECK_EVERY = 6 * 60 * 60_000
const LEVELS = [100, 80] as const

/** What grows and the cheapest fix, for each figure that can have a limit. */
const FIXES: Partial<Record<UsageFigure['metric'], { what: string; fix: string }>> = {
  'build-minutes': {
    what: 'build minutes',
    fix: 'build only when the app’s files change (an ignore command in the build settings) and cache dependencies between builds',
  },
  storage: {
    what: 'database storage',
    fix: 'delete data and branches the app no longer needs',
  },
  compute: {
    what: 'database compute time',
    fix: 'let the database sleep when idle and lower its largest size',
  },
}

/** What the notices need from the host, so tests can run them without a database. */
export interface UsageNoticeHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  projects(): { id: string; name: string }[]
  /** The project's most recent open thread, which the notice opens. */
  latestThread(projectId: string): { taskId: string; sessionId: string } | null
  raise(notice: InboxNotice): void
}

const sentKey = (projectId: string) => `usage-notices:${projectId}`

/** Reads usage every few hours and raises one notice per figure, period and level (80% and 100%). */
export class UsageNotices {
  private running: Promise<void> | null = null
  private nextCheck = 0
  private stopping = false

  constructor(
    private readonly host: UsageNoticeHost,
    /** A project with no deploy target or resources reads nothing from any platform. */
    private readonly read: (projectId: string) => Promise<UsageReport[]>,
  ) {}

  tick(now = Date.now()): Promise<void> {
    if (this.stopping || this.running || now < this.nextCheck) return this.running ?? Promise.resolve()
    this.nextCheck = now + CHECK_EVERY
    this.running = this.check(now).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async check(now: number): Promise<void> {
    for (const project of this.host.projects()) {
      if (this.stopping) return
      try {
        for (const report of await this.read(project.id)) this.notify(project, report, now)
      } catch (error) {
        console.error('Usage notices:', project.id, error)
      }
    }
  }

  private notify(project: { id: string; name: string }, report: UsageReport, now: number): void {
    for (const figure of report.figures) {
      const words = FIXES[figure.metric]
      if (!words || !figure.limit) continue
      const share = figure.used / figure.limit
      const level = LEVELS.find((entry) => share * 100 >= entry)
      if (!level) continue
      const key = `${report.platform}:${figure.metric}:${report.period?.start ?? 'current'}:${level}`
      const sent = this.host.getState<string[]>(sentKey(project.id), [])
      // 100% after 80% in the same period is its own notice; 80% after 100% is not.
      if (sent.some((entry) => entry === key || (level === 80 && entry === key.replace(/:80$/, ':100')))) continue
      const thread = this.host.latestThread(project.id)
      if (!thread) continue
      this.host.setState(sentKey(project.id), [key, ...sent].slice(0, 50))
      const used = level === 100 ? 'has used all' : `has used ${Math.floor(share * 100)}%`
      this.host.raise({
        id: `usage:${project.id}:${key}`,
        taskId: thread.taskId,
        sessionId: thread.sessionId,
        kind: 'usage',
        title: `${project.name}: ${report.name} ${words.what} at ${level}%`,
        body: `${project.name} ${used} of the ${words.what} in your ${report.name} plan this period. Cheapest fix: ${words.fix}. Or raise the plan on ${report.name}’s billing page; Ramu never changes it.`,
        at: now,
      })
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.running
  }
}
