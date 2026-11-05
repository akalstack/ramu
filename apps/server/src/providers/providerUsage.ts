// Plan usage for providers whose runtimes do not report it, read from the same sources their own apps use.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageReading } from '@ramu/shared/types'
import { storedCursorKey } from './cursorAuth'
import { antigravityScopeOf } from '@ramu/shared/providers/usageScope'

type Json = Record<string, any>
const DEFAULT_CURSOR_ENDPOINT = 'https://api2.cursor.sh'
const clamp = (value: number) => Math.max(0, Math.min(100, value))
const statusOf = (usedPercent: number): UsageReading['status'] =>
  usedPercent >= 100 ? 'limited' : usedPercent >= 80 ? 'warning' : 'ok'

async function json(url: string, init: RequestInit): Promise<Json> {
  // Never follow redirects with a credential attached.
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as Json
}

/**
 * Cursor's monthly plan usage from the CLI's own login, as the dashboard shows it. Overall is the combined figure and
 * is not a third quota; Cursor models (Composer, Grok) and Other models (Claude, GPT, Gemini) are the two allowances
 * behind it. The pools carry a scope for display only: no model id contains it, so they never block a model on their own.
 */
const CURSOR_POOLS = [
  { key: 'totalPercentUsed' },
  { key: 'autoPercentUsed', scope: 'Cursor models' },
  { key: 'apiPercentUsed', scope: 'Other models' },
] as const
export function cursorUsageReadings(response: Json, now = Date.now()): UsageReading[] {
  const end = Number(response?.billingCycleEnd)
  return CURSOR_POOLS.flatMap((pool): UsageReading[] => {
    const used = response?.planUsage?.[pool.key]
    if (typeof used !== 'number' || !Number.isFinite(used)) return []
    const usedPercent = Math.round(clamp(used) * 10) / 10
    return [
      {
        provider: 'cursor',
        window: 'monthly',
        ...('scope' in pool ? { scope: pool.scope } : {}),
        usedPercent,
        status: statusOf(usedPercent),
        ...(end > 0 ? { resetsAt: end } : {}),
        updatedAt: now,
      },
    ]
  })
}
/** The Cursor login for usage, read from files only: an explicit token, the CLI's login file, or the SDK's saved key. */
async function cursorToken(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const given = env.CURSOR_AUTH_TOKEN?.trim()
  if (given) return given
  // An explicit API key can belong to a different account than the stored login.
  if (env.CURSOR_API_KEY?.trim()) return undefined
  if (env.AGENT_CLI_CREDENTIAL_STORE === 'memory') return undefined
  const directory =
    env.CURSOR_CONFIG_DIR?.trim() ||
    (process.platform === 'win32'
      ? join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cursor')
      : process.platform === 'darwin'
        ? join(homedir(), '.cursor')
        : join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'cursor'))
  try {
    const token = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8')).accessToken
    if (typeof token === 'string' && token.trim()) return token.trim()
  } catch {
    /* No CLI login file; try the SDK's. */
  }
  return storedCursorKey(env)
}
export async function readCursorUsage(env: NodeJS.ProcessEnv = process.env): Promise<UsageReading[]> {
  const endpoint = (env.CURSOR_API_ENDPOINT?.trim() || DEFAULT_CURSOR_ENDPOINT).replace(/\/$/, '')
  // The login belongs to Cursor's own service; do not send it anywhere else.
  if (endpoint !== DEFAULT_CURSOR_ENDPOINT) return []
  const token = await cursorToken(env)
  if (!token) return []
  return cursorUsageReadings(
    await json(`${endpoint}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'connect-protocol-version': '1',
        'x-cursor-client-type': 'cli',
      },
      body: '{}',
    }),
  )
}

const AGY_ENDPOINTS = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com']
type Bucket = { bucketId?: string; window?: string; disabled?: boolean; remainingFraction?: number; resetTime?: string }
const usedOf = (remainingFraction: number) =>
  Math.round(clamp((1 - Math.max(0, Math.min(1, remainingFraction))) * 100) * 10) / 10
/**
 * Antigravity's quota summary: one reading per group and window (Gemini, Gemini 4 Argon, and Claude & GPT, which share
 * one allowance). A bucket is placed by its id, else by its group's name. The fullest bucket per group and window wins.
 */
export function antigravityUsageReadings(summary: Json, now = Date.now()): UsageReading[] {
  const groups: { displayName?: string; buckets?: Bucket[] }[] = summary?.groups?.some(
    (group: Json) => group?.buckets?.length,
  )
    ? summary.groups
    : [{ buckets: summary?.buckets }]
  const readings = new Map<string, UsageReading>()
  for (const group of groups)
    for (const bucket of group?.buckets ?? []) {
      if (
        bucket.disabled ||
        typeof bucket.bucketId !== 'string' ||
        typeof bucket.remainingFraction !== 'number' ||
        !Number.isFinite(bucket.remainingFraction)
      )
        continue
      const window = bucket.window === 'weekly' ? 'weekly' : bucket.window === '5h' ? 'five_hour' : undefined
      const scope =
        antigravityScopeOf(bucket.bucketId) ??
        (typeof group.displayName === 'string' ? antigravityScopeOf(group.displayName) : undefined)
      if (!window || !scope) continue
      const usedPercent = usedOf(bucket.remainingFraction)
      const resetsAt = bucket.resetTime ? Date.parse(bucket.resetTime) : NaN
      const key = `${scope}:${window}`
      if ((readings.get(key)?.usedPercent ?? -1) >= usedPercent) continue
      readings.set(key, {
        provider: 'antigravity',
        window,
        scope,
        usedPercent,
        status: statusOf(usedPercent),
        ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
        updatedAt: now,
      })
    }
  return [...readings.values()]
}

type Quota = { remainingFraction?: number; resetTime?: string }
/**
 * The model list reports a quota per model, grouped the same way as the summary. A quota with no stated window is a
 * `quota` reading (no invented reset cadence); a weekly one is weekly. The fullest model per group wins. Models that
 * belong to no group (tab completion, internal chat models) are left out.
 */
export function antigravityModelReadings(models: Json, now = Date.now()): UsageReading[] {
  const readings = new Map<string, UsageReading>()
  for (const [id, model] of Object.entries<Json>(models?.models ?? {})) {
    const scope =
      antigravityScopeOf(id) ??
      (typeof model?.displayName === 'string' ? antigravityScopeOf(model.displayName) : undefined)
    if (!scope) continue
    for (const [window, quota] of [
      ['quota', model.quotaInfo as Quota | undefined],
      ['weekly', model.weeklyQuotaInfo as Quota | undefined],
    ] as const) {
      if (typeof quota?.remainingFraction !== 'number' || !Number.isFinite(quota.remainingFraction)) continue
      const usedPercent = usedOf(quota.remainingFraction)
      const resetsAt = quota.resetTime ? Date.parse(quota.resetTime) : NaN
      const key = `${scope}:${window}`
      if ((readings.get(key)?.usedPercent ?? -1) >= usedPercent) continue
      readings.set(key, {
        provider: 'antigravity',
        window,
        scope,
        usedPercent,
        status: statusOf(usedPercent),
        ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
        updatedAt: now,
      })
    }
  }
  return [...readings.values()]
}

/** The summary's groups first; the model list fills any group the summary leaves out (often Gemini). */
export function mergeAntigravityReadings(summary: UsageReading[], models: UsageReading[]): UsageReading[] {
  const covered = new Set(summary.map((reading) => reading.scope))
  return [...summary, ...models.filter((reading) => !covered.has(reading.scope))]
}
/** The runtime's login file. Ramu runs it with file storage, so the macOS Keychain is never read. */
async function antigravityToken(env: NodeJS.ProcessEnv): Promise<Json | undefined> {
  try {
    const home = env.GEMINI_HOME || join(homedir(), '.gemini')
    return JSON.parse(
      await readFile(
        join(home.startsWith('~/') ? join(homedir(), home.slice(2)) : home, 'antigravity-acp', 'acp_token.json'),
        'utf8',
      ),
    )
  } catch {
    return undefined
  }
}
export async function readAntigravityUsage(env: NodeJS.ProcessEnv = process.env): Promise<UsageReading[]> {
  const file = await antigravityToken(env)
  if (!file) return []
  if (![file.client_id, file.client_secret, file.refresh_token].every((value) => typeof value === 'string' && value))
    return []
  const refreshed = await json('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: file.client_id,
      client_secret: file.client_secret,
      refresh_token: file.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (typeof refreshed.access_token !== 'string') return []
  const headers = {
    Authorization: `Bearer ${refreshed.access_token}`,
    'content-type': 'application/json',
    'User-Agent': `antigravity/hub/1.0.0 (aidev_client; os_type=${process.platform}; arch=${process.arch})`,
  }
  const body = JSON.stringify(
    typeof file.project_id === 'string' && file.project_id ? { project: file.project_id } : {},
  )
  const ask = async (operation: string, parse: (response: Json) => UsageReading[]) => {
    for (const endpoint of AGY_ENDPOINTS) {
      try {
        const readings = parse(await json(`${endpoint}/v1internal:${operation}`, { method: 'POST', headers, body }))
        if (readings.length) return readings
      } catch {}
    }
    return []
  }
  const [summary, models] = await Promise.all([
    ask('retrieveUserQuotaSummary', (response) => antigravityUsageReadings(response)),
    ask('fetchAvailableModels', (response) => antigravityModelReadings(response)),
  ])
  return mergeAntigravityReadings(summary, models)
}

/** Reads Cursor's default login at most every five minutes when enabled. */
export class ExtraUsageReader {
  private last = new Map<string, number>()
  constructor(
    private readonly update: (readings: UsageReading[]) => void,
    private readonly settings: () => { cursor: boolean },
  ) {}
  async refresh(now = Date.now()): Promise<void> {
    const { cursor } = this.settings()
    const run = async (name: string, enabled: boolean, read: () => Promise<UsageReading[]>) => {
      if (!enabled || now - (this.last.get(name) ?? 0) < 5 * 60_000) return
      this.last.set(name, now)
      try {
        const readings = await read()
        if (readings.length) this.update(readings)
      } catch {
        this.last.delete(name)
      }
    }
    await run('cursor', cursor, () => readCursorUsage())
  }
}
