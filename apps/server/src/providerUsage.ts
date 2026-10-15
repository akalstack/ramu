// Plan usage for providers whose runtimes do not report it, read from the same sources their own apps use.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageReading } from '@ramu/shared/types'

type Json = Record<string, any>
const DEFAULT_CURSOR_ENDPOINT = 'https://api2.cursor.sh'
const clamp = (value: number) => Math.max(0, Math.min(100, value))
const statusOf = (usedPercent: number): UsageReading['status'] => usedPercent >= 100 ? 'limited' : usedPercent >= 80 ? 'warning' : 'ok'

async function json(url: string, init: RequestInit): Promise<Json> {
  // Never follow redirects with a credential attached.
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json() as Json
}

/** Cursor's monthly plan usage from the CLI's own login. The Keychain is only touched when the user allowed it. */
export function cursorUsageReadings(response: Json, now = Date.now()): UsageReading[] {
  const used = response?.planUsage?.totalPercentUsed
  if (typeof used !== 'number' || !Number.isFinite(used)) return []
  const end = Number(response.billingCycleEnd)
  const usedPercent = Math.round(clamp(used) * 10) / 10
  return [{ provider: 'cursor', window: 'monthly', usedPercent, status: statusOf(usedPercent), ...(end > 0 ? { resetsAt: end } : {}), updatedAt: now }]
}
async function cursorToken(allowKeychain: boolean, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const given = env.CURSOR_AUTH_TOKEN?.trim()
  if (given) return given
  // An explicit API key can belong to a different account than the stored login.
  if (env.CURSOR_API_KEY?.trim()) return undefined
  const store = env.AGENT_CLI_CREDENTIAL_STORE
  if (store === 'memory') return undefined
  if (process.platform === 'darwin' && store !== 'file') {
    if (!allowKeychain) return undefined
    return await new Promise<string | undefined>((resolve) => execFile('/usr/bin/security', ['find-generic-password', '-s', 'cursor-access-token', '-a', 'cursor-user', '-w'], { timeout: 15_000, maxBuffer: 64 * 1024 }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined)))
  }
  const directory = env.CURSOR_CONFIG_DIR?.trim() || (process.platform === 'win32' ? join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cursor') : process.platform === 'darwin' ? join(homedir(), '.cursor') : join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'cursor'))
  try { const token = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8')).accessToken; return typeof token === 'string' && token.trim() ? token.trim() : undefined } catch { return undefined }
}
export async function readCursorUsage(allowKeychain: boolean, env: NodeJS.ProcessEnv = process.env): Promise<UsageReading[]> {
  const endpoint = (env.CURSOR_API_ENDPOINT?.trim() || DEFAULT_CURSOR_ENDPOINT).replace(/\/$/, '')
  // The login belongs to Cursor's own service; do not send it anywhere else.
  if (endpoint !== DEFAULT_CURSOR_ENDPOINT) return []
  const token = await cursorToken(allowKeychain, env)
  if (!token) return []
  return cursorUsageReadings(await json(`${endpoint}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-cursor-client-type': 'cli' }, body: '{}' }))
}

const AGY_ENDPOINTS = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com']
type Bucket = { bucketId?: string; window?: string; disabled?: boolean; remainingFraction?: number; resetTime?: string }
/** Antigravity quota buckets: Gemini and the shared Claude/GPT allowance, each with a 5-hour and a weekly window. */
export function antigravityUsageReadings(summary: Json, now = Date.now()): UsageReading[] {
  const groups: { buckets?: Bucket[] }[] = summary?.groups?.some((group: Json) => group?.buckets?.length) ? summary.groups : [{ buckets: summary?.buckets }]
  const readings = new Map<string, UsageReading>()
  for (const bucket of groups.flatMap((group) => group?.buckets ?? [])) {
    if (bucket.disabled || typeof bucket.bucketId !== 'string' || typeof bucket.remainingFraction !== 'number' || !Number.isFinite(bucket.remainingFraction)) continue
    const window = bucket.window === 'weekly' ? 'weekly' : bucket.window === '5h' ? 'five_hour' : undefined
    if (!window) continue
    // The scope is matched against model IDs, so it names the model family.
    const scope = bucket.bucketId.startsWith('gemini-') ? 'Gemini' : bucket.bucketId.startsWith('3p-') ? 'Claude' : undefined
    if (!scope) continue
    const usedPercent = Math.round(clamp((1 - Math.max(0, Math.min(1, bucket.remainingFraction))) * 100) * 10) / 10
    const resetsAt = bucket.resetTime ? Date.parse(bucket.resetTime) : NaN
    const reading: UsageReading = { provider: 'antigravity', window, scope, usedPercent, status: statusOf(usedPercent), ...(Number.isFinite(resetsAt) ? { resetsAt } : {}), updatedAt: now }
    const key = `${scope}:${window}`
    if ((readings.get(key)?.usedPercent ?? -1) < usedPercent) readings.set(key, reading)
  }
  return [...readings.values()]
}
export async function readAntigravityUsage(env: NodeJS.ProcessEnv = process.env): Promise<UsageReading[]> {
  // The runtime keeps its OAuth client and refresh token here when it stores credentials in a file.
  let file: Json
  try { file = JSON.parse(await readFile(join(env.GEMINI_HOME || join(homedir(), '.gemini'), 'antigravity-acp', 'acp_token.json'), 'utf8')) } catch { return [] }
  if (![file.client_id, file.client_secret, file.refresh_token].every((value) => typeof value === 'string' && value)) return []
  const refreshed = await json('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: file.client_id, client_secret: file.client_secret, refresh_token: file.refresh_token, grant_type: 'refresh_token' }) })
  if (typeof refreshed.access_token !== 'string') return []
  for (const endpoint of AGY_ENDPOINTS) {
    try {
      const summary = await json(`${endpoint}/v1internal:retrieveUserQuotaSummary`, { method: 'POST', headers: { Authorization: `Bearer ${refreshed.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(typeof file.project_id === 'string' && file.project_id ? { project: file.project_id } : {}) })
      const readings = antigravityUsageReadings(summary)
      if (readings.length) return readings
    } catch {}
  }
  return []
}

/** Reads the extra providers' usage at most every five minutes each, skipping any the user turned off. */
export class ExtraUsageReader {
  private last = new Map<string, number>()
  constructor(private readonly update: (readings: UsageReading[]) => void, private readonly settings: () => { cursor: boolean; antigravity: boolean; keychain: boolean }) {}
  async refresh(now = Date.now()): Promise<void> {
    const { cursor, antigravity, keychain } = this.settings()
    const run = async (name: string, enabled: boolean, read: () => Promise<UsageReading[]>) => {
      if (!enabled || now - (this.last.get(name) ?? 0) < 5 * 60_000) return
      this.last.set(name, now)
      try { const readings = await read(); if (readings.length) this.update(readings) } catch { this.last.delete(name) }
    }
    await Promise.all([run('cursor', cursor, () => readCursorUsage(keychain)), run('antigravity', antigravity, () => readAntigravityUsage())])
  }
}
