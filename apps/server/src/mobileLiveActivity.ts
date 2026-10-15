import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'
import { connect, constants } from 'node:http2'
import type { MobileLiveActivityContent, MobileLiveActivityRegistration } from '@ramu/shared/api'

export interface ApnsConfig { keyPath: string; keyId: string; teamId: string; bundleId: string }
export function liveActivityApnsConfig(): ApnsConfig | null {
  const keyPath = process.env.RAMU_APNS_KEY_PATH, keyId = process.env.RAMU_APNS_KEY_ID, teamId = process.env.RAMU_APNS_TEAM_ID
  const bundleId = process.env.RAMU_APNS_BUNDLE_ID ?? 'dev.ramu.mobile'
  return keyPath && existsSync(keyPath) && keyId && /^[A-Z0-9]{10}$/.test(keyId) && teamId && /^[A-Z0-9]{10}$/.test(teamId) && /^[a-zA-Z0-9.-]{3,200}$/.test(bundleId) ? { keyPath, keyId, teamId, bundleId } : null
}
export function apnsAuthorization(config: ApnsConfig, now = Date.now()): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) })).toString('base64url')
  const value = `${header}.${claims}`
  const signature = sign('sha256', Buffer.from(value), { key: createPrivateKey(readFileSync(config.keyPath)), dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${value}.${signature}`
}
interface ApnsPayload { aps: { timestamp: number; event: 'update' | 'end'; 'content-state': { name: 'RamuWork'; props: string }; 'stale-date'?: number; 'dismissal-date'?: number } }
export type LiveActivitySender = (token: string, payload: ApnsPayload, environment: 'sandbox' | 'production') => Promise<{ status: number; reason?: string }>
export function createLiveActivitySender(config: () => ApnsConfig | null = liveActivityApnsConfig): LiveActivitySender {
  let authorization = '', authorizedAt = 0
  return async (token, payload, environment) => {
    const current = config()
    if (!current) throw new Error('Live Activity background updates are not configured')
    if (!authorization || Date.now() - authorizedAt > 45 * 60_000) { authorization = apnsAuthorization(current); authorizedAt = Date.now() }
    return new Promise((resolve, reject) => {
      const client = connect(environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com')
      client.once('error', reject)
      const request = client.request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${authorization}`, 'apns-push-type': 'liveactivity', 'apns-topic': `${current.bundleId}.push-type.liveactivity`, 'apns-priority': payload.aps.event === 'end' ? '10' : '5', 'apns-expiration': '0', 'content-type': 'application/json' })
      let status = 0, response = ''
      request.on('response', headers => { status = Number(headers[':status']) })
      request.setEncoding('utf8')
      request.on('data', data => { response = (response + data).slice(0, 8192) })
      request.setTimeout(10_000, () => { request.close(constants.NGHTTP2_CANCEL); client.destroy(); reject(new Error('Live Activity delivery timed out')) })
      request.once('error', error => { client.destroy(); reject(error) })
      request.on('end', () => { client.close(); let reason: string | undefined; try { reason = JSON.parse(response).reason } catch {}; resolve({ status, reason }) })
      request.end(JSON.stringify(payload))
    })
  }
}
interface Registration extends MobileLiveActivityRegistration { deviceId: string; sentAt?: number; signature?: string }
/** Paired-device-owned ActivityKit tokens; the APNs payload contains counts, never transcript data. */
export class MobileLiveActivities {
  private registrations: Registration[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private busy = false
  constructor(private path: string, private devices: () => { id: string }[], private counts: () => { running: number; needsInput: number }, private sender: LiveActivitySender = createLiveActivitySender(), private configured: () => boolean = () => !!liveActivityApnsConfig()) {
    try { const saved = JSON.parse(readFileSync(path, 'utf8')); if (Array.isArray(saved)) this.registrations = saved.filter(r => this.valid(r) && typeof r.deviceId === 'string') } catch {}
  }
  get enabled() { return this.configured() }
  private valid(r: MobileLiveActivityRegistration) {
    return r && typeof r.activityId === 'string' && typeof r.token === 'string' && typeof r.computerId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(r.activityId) && /^[a-fA-F0-9]{64,256}$/.test(r.token) && /^[a-zA-Z0-9_-]{1,100}$/.test(r.computerId) && Number.isFinite(r.startedAt) && ['en', 'id'].includes(r.locale) && ['sandbox', 'production'].includes(r.environment)
  }
  private save() { const temp = `${this.path}.tmp`; writeFileSync(temp, JSON.stringify(this.registrations), { mode: 0o600 }); renameSync(temp, this.path) }
  register(deviceId: string, value: MobileLiveActivityRegistration) {
    if (!this.devices().some(d => d.id === deviceId)) throw new Error('Live Activities require a paired phone')
    if (!this.valid(value) || value.startedAt > Date.now() + 5 * 60_000 || value.startedAt < Date.now() - 8 * 60 * 60_000) throw new Error('Invalid Live Activity registration')
    const token = value.token.toLowerCase()
    if (this.registrations.some(r => r.deviceId !== deviceId && (r.token.toLowerCase() === token || r.activityId === value.activityId))) throw new Error('This Live Activity belongs to another paired phone')
    if (!this.enabled) return { enabled: false }
    this.registrations = [...this.registrations.filter(r => r.deviceId !== deviceId), { activityId: value.activityId, token, computerId: value.computerId, startedAt: value.startedAt, locale: value.locale, environment: value.environment, deviceId }]; this.save(); this.observe()
    return { enabled: true }
  }
  remove(deviceId: string, activityId: string) {
    this.registrations = this.registrations.filter(r => r.deviceId !== deviceId || r.activityId !== activityId); this.save()
  }
  observe() { if (!this.timer) { this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => {}) }, 1500); this.timer.unref() } }
  private payload(r: Registration, counts: { running: number; needsInput: number }, ended: boolean, immediate = false): ApnsPayload {
    const now = Date.now()
    const props: MobileLiveActivityContent = { running: ended ? 0 : counts.running, waiting: ended ? 0 : counts.needsInput, startedAt: r.startedAt, updatedAt: now, locale: r.locale, phase: ended ? 'finished' : counts.needsInput ? 'waiting' : 'working' }
    return { aps: { timestamp: Math.floor(now / 1000), event: ended ? 'end' : 'update', 'content-state': { name: 'RamuWork', props: JSON.stringify(props) }, ...(ended ? { 'dismissal-date': immediate ? 0 : Math.floor(now / 1000) + 15 * 60 } : { 'stale-date': Math.floor(now / 1000) + 10 * 60 }) } }
  }
  async flush() {
    if (this.busy || !this.enabled) return
    this.busy = true
    try {
      const devices = new Set(this.devices().map(d => d.id)), counts = this.counts()
      const bounded = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(9999, Math.floor(value))) : 0
      const normalized = { running: bounded(counts.running), needsInput: bounded(counts.needsInput) }
      const signature = JSON.stringify(normalized)
      for (const r of [...this.registrations]) {
        const revoked = !devices.has(r.deviceId), expired = Date.now() - r.startedAt >= 8 * 60 * 60_000
        const ended = revoked || expired || normalized.running + normalized.needsInput === 0
        if (!ended && r.signature === signature && Date.now() - (r.sentAt ?? 0) < 5 * 60_000) continue
        try {
          const result = await this.sender(r.token, this.payload(r, normalized, ended, revoked || expired), r.environment)
          if (ended && result.status === 200 || revoked || expired || result.status === 410 || result.reason === 'BadDeviceToken' || result.reason === 'DeviceTokenNotForTopic') this.registrations = this.registrations.filter(current => current !== r)
          else if (result.status === 200) { r.sentAt = Date.now(); r.signature = signature }
        } catch { if (revoked || expired) this.registrations = this.registrations.filter(current => current !== r) }
      }
      this.save()
    } finally { this.busy = false }
  }
  dispose() { if (this.timer) clearTimeout(this.timer) }
}
