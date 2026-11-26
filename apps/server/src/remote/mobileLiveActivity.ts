import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'
import { connect, constants } from 'node:http2'
import type { MobileLiveActivityRegistration } from '@ramu/shared/api'
import { translate } from '@ramu/shared/i18n'
import { LIVE_ACTIVITY_DONE_MS, LIVE_ACTIVITY_STALE_MS, liveActivityCountsContent } from '@ramu/shared/liveActivity'
import {
  LINK_URL,
  LIVE_ACTIVITY_PATH,
  liveActivityApsPayload,
  type LiveActivityPush,
  type LiveActivityPushReply,
} from '@ramu/shared/ramuLink'

export interface ApnsConfig {
  keyPath: string
  keyId: string
  teamId: string
  bundleId: string
}
export function liveActivityApnsConfig(): ApnsConfig | null {
  const keyPath = process.env.RAMU_APNS_KEY_PATH,
    keyId = process.env.RAMU_APNS_KEY_ID,
    teamId = process.env.RAMU_APNS_TEAM_ID
  const bundleId = process.env.RAMU_APNS_BUNDLE_ID ?? 'com.akalstack.ramu'
  return keyPath &&
    existsSync(keyPath) &&
    keyId &&
    /^[A-Z0-9]{10}$/.test(keyId) &&
    teamId &&
    /^[A-Z0-9]{10}$/.test(teamId) &&
    /^[a-zA-Z0-9.-]{3,200}$/.test(bundleId)
    ? { keyPath, keyId, teamId, bundleId }
    : null
}
export function apnsAuthorization(config: ApnsConfig, now = Date.now()): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) })).toString('base64url')
  const value = `${header}.${claims}`
  const signature = sign('sha256', Buffer.from(value), {
    key: createPrivateKey(readFileSync(config.keyPath)),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return `${value}.${signature}`
}
/** Sends one Live Activity push and says what Apple answered. */
export type LiveActivitySender = (push: LiveActivityPush) => Promise<LiveActivityPushReply>

/** Sends with this host's own Apple key (RAMU_APNS_*), for a self-built app or a host that has one. */
export function createLiveActivitySender(config: () => ApnsConfig | null = liveActivityApnsConfig): LiveActivitySender {
  let authorization = '',
    authorizedAt = 0
  return async (push) => {
    const current = config()
    if (!current) throw new Error('Live Activity background updates are not configured')
    if (!authorization || Date.now() - authorizedAt > 45 * 60_000) {
      authorization = apnsAuthorization(current)
      authorizedAt = Date.now()
    }
    return new Promise((resolve, reject) => {
      const client = connect(
        push.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com',
      )
      client.once('error', reject)
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${push.token}`,
        authorization: `bearer ${authorization}`,
        'apns-push-type': 'liveactivity',
        'apns-topic': `${current.bundleId}.push-type.liveactivity`,
        'apns-priority': push.event === 'update' ? '5' : '10',
        'apns-expiration': '0',
        'content-type': 'application/json',
      })
      let status = 0,
        response = ''
      request.on('response', (headers) => {
        status = Number(headers[':status'])
      })
      request.setEncoding('utf8')
      request.on('data', (data) => {
        response = (response + data).slice(0, 8192)
      })
      request.setTimeout(10_000, () => {
        request.close(constants.NGHTTP2_CANCEL)
        client.destroy()
        reject(new Error('Live Activity delivery timed out'))
      })
      request.once('error', (error) => {
        client.destroy()
        reject(error)
      })
      request.on('end', () => {
        client.close()
        let reason: string | undefined
        try {
          reason = JSON.parse(response).reason
        } catch {}
        resolve({ status, reason })
      })
      request.end(JSON.stringify(liveActivityApsPayload(push, Date.now())))
    })
  }
}

/**
 * Sends through Ramu Link, which holds the Ramu app's Apple key, signed in with this host's Ramu account. A host
 * that is signed out gets 401 and keeps its activities updated only while the phone has Ramu open.
 */
export function createLinkLiveActivitySender(
  bearer: () => Promise<string | null>,
  fetcher: typeof fetch = fetch,
  relay = LINK_URL,
): LiveActivitySender {
  return async (push) => {
    const token = await bearer()
    if (!token) return { status: 401 }
    const response = await fetcher(`${relay}${LIVE_ACTIVITY_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(push),
      signal: AbortSignal.timeout(15_000),
    })
    // Link with no Apple key answers 503 itself, unlike a 503 Apple passes back with its reason.
    if (response.status === 503) return { status: 503, reason: LINK_UNAVAILABLE }
    if (!response.ok) return { status: response.status }
    const reply = (await response.json()) as Partial<LiveActivityPushReply>
    return {
      status: typeof reply.status === 'number' ? reply.status : 502,
      ...(typeof reply.reason === 'string' ? { reason: reply.reason.slice(0, 100) } : {}),
    }
  }
}

/** A phone's push-to-start token: lets the host start its Live Activity when work begins while Ramu is closed. */
interface StartRegistration {
  deviceId: string
  token: string
  computerId: string
  locale: 'en' | 'id'
  environment: 'sandbox' | 'production'
  /** The stretch of work (its start time) this phone was last started for, so each stretch starts it at most once. */
  startedFor?: number
}

/** How long work runs before the host starts an activity, so a phone with Ramu open starts its own first. */
export const START_DELAY_MS = 15_000
/** The reason a Link sender gives when Link itself cannot send, as opposed to Apple refusing one push. */
const LINK_UNAVAILABLE = 'LinkUnavailable'
/** How long the host stops using Link after Link said it has no Apple key, before asking again. */
const LINK_RETRY_MS = 10 * 60_000

interface Registration extends MobileLiveActivityRegistration {
  deviceId: string
  sentAt?: number
  signature?: string
}
const validStart = (value: unknown): value is Omit<StartRegistration, 'deviceId' | 'startedFor'> => {
  const r = value as Partial<StartRegistration> | null
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.token === 'string' &&
    typeof r.computerId === 'string' &&
    /^[a-fA-F0-9]{64,256}$/.test(r.token) &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(r.computerId) &&
    (r.locale === 'en' || r.locale === 'id') &&
    (r.environment === 'sandbox' || r.environment === 'production')
  )
}
/** What iOS shows as an activity the host started appears: the phone's own words, so in its language. */
const startAlert = (locale: 'en' | 'id', counts: { running: number; needsInput: number }) => ({
  title: 'Ramu',
  body: translate(
    locale,
    counts.needsInput
      ? counts.needsInput === 1
        ? 'An agent needs your input'
        : '{0} agents need your input'
      : counts.running === 1
        ? 'An agent is working'
        : '{0} agents are working',
    { 0: String(counts.needsInput || counts.running) },
  ),
})

/**
 * Paired-device-owned ActivityKit tokens; the pushes carry counts, never transcript data. They go through this host's
 * own Apple key when it has one, else through Ramu Link with the host's Ramu account.
 */
export class MobileLiveActivities {
  private registrations: Registration[] = []
  private starts: StartRegistration[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private busy = false
  /** When the current stretch of work began, 0 while no thread is working or waiting. */
  private workingSince = 0
  /** Until when sending is off, after the route said it cannot send (Link with no Apple key). */
  private unavailableUntil = 0
  constructor(
    private path: string,
    private devices: () => { id: string }[],
    private counts: () => { running: number; needsInput: number },
    private sender: LiveActivitySender = createLiveActivitySender(),
    private configured: () => boolean | Promise<boolean> = () => !!liveActivityApnsConfig(),
  ) {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(saved))
        this.registrations = saved.filter(
          (r: { deviceId?: unknown }) => this.valid(r) && typeof r.deviceId === 'string',
        )
    } catch {}
    try {
      const saved = JSON.parse(readFileSync(this.startsPath, 'utf8'))
      if (Array.isArray(saved))
        this.starts = saved.filter(
          (r: { deviceId?: unknown }) => validStart(r) && typeof r.deviceId === 'string',
        ) as StartRegistration[]
    } catch {}
  }
  private get startsPath() {
    return this.path.replace(/(\.json)?$/, '-starts.json')
  }
  /** Whether pushes can reach the phone while Ramu is closed: a route is set up and has not just refused. */
  async available(): Promise<boolean> {
    return Date.now() >= this.unavailableUntil && (await this.configured())
  }
  private valid(value: unknown): value is MobileLiveActivityRegistration {
    const r = value as Partial<MobileLiveActivityRegistration> | null
    return (
      !!r &&
      typeof r === 'object' &&
      typeof r.activityId === 'string' &&
      typeof r.token === 'string' &&
      typeof r.computerId === 'string' &&
      /^[a-zA-Z0-9_-]{1,200}$/.test(r.activityId) &&
      /^[a-fA-F0-9]{64,256}$/.test(r.token) &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(r.computerId) &&
      Number.isFinite(r.startedAt) &&
      (r.locale === 'en' || r.locale === 'id') &&
      (r.environment === 'sandbox' || r.environment === 'production')
    )
  }
  private save() {
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify(this.registrations), { mode: 0o600 })
    renameSync(temp, this.path)
    const startsTemp = `${this.startsPath}.tmp`
    writeFileSync(startsTemp, JSON.stringify(this.starts), { mode: 0o600 })
    renameSync(startsTemp, this.startsPath)
  }
  /** `value` arrives from the phone unvalidated; it is checked here before anything is stored. */
  async register(deviceId: string, value: unknown) {
    if (!this.devices().some((d) => d.id === deviceId)) throw new Error('Live Activities require a paired phone')
    if (
      !this.valid(value) ||
      value.startedAt > Date.now() + 5 * 60_000 ||
      value.startedAt < Date.now() - 8 * 60 * 60_000
    )
      throw new Error('Invalid Live Activity registration')
    const token = value.token.toLowerCase()
    if (
      this.registrations.some(
        (r) => r.deviceId !== deviceId && (r.token.toLowerCase() === token || r.activityId === value.activityId),
      )
    )
      throw new Error('This Live Activity belongs to another paired phone')
    if (!(await this.available())) return { enabled: false }
    this.registrations = [
      ...this.registrations.filter((r) => r.deviceId !== deviceId),
      {
        activityId: value.activityId,
        token,
        computerId: value.computerId,
        startedAt: value.startedAt,
        locale: value.locale,
        environment: value.environment,
        deviceId,
      },
    ]
    this.save()
    this.observe()
    return { enabled: true }
  }
  remove(deviceId: string, activityId: string) {
    this.registrations = this.registrations.filter((r) => r.deviceId !== deviceId || r.activityId !== activityId)
    this.save()
  }
  /** The phone's push-to-start token, so work on this host starts its Live Activity while Ramu is closed. */
  registerStart(deviceId: string, value: unknown) {
    if (!this.devices().some((d) => d.id === deviceId)) throw new Error('Live Activities require a paired phone')
    if (!validStart(value)) throw new Error('Invalid Live Activity registration')
    const token = value.token.toLowerCase()
    const previous = this.starts.find((r) => r.deviceId === deviceId)
    this.starts = [
      ...this.starts.filter((r) => r.deviceId !== deviceId && r.token !== token),
      {
        deviceId,
        token,
        computerId: value.computerId,
        locale: value.locale,
        environment: value.environment,
        // A phone registering again during work it was already started for is not started twice.
        ...(previous?.startedFor ? { startedFor: previous.startedFor } : {}),
      },
    ]
    this.save()
    this.observe()
  }
  /** The phone turned Live Activities off, dismissed the current one, or follows another host now. */
  removeStart(deviceId: string) {
    this.starts = this.starts.filter((r) => r.deviceId !== deviceId)
    this.save()
  }
  observe() {
    this.schedule(1500)
  }
  private schedule(ms: number) {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(() => {})
    }, ms)
    this.timer.unref()
  }
  private props(
    startedAt: number,
    locale: 'en' | 'id',
    counts: { running: number; needsInput: number },
    ended: boolean,
  ) {
    return JSON.stringify(liveActivityCountsContent(counts, { startedAt, updatedAt: Date.now(), locale }, ended))
  }
  private push(
    r: Registration,
    counts: { running: number; needsInput: number },
    ended: boolean,
    immediate = false,
  ): LiveActivityPush {
    const now = Math.floor(Date.now() / 1000)
    return {
      token: r.token,
      environment: r.environment,
      event: ended ? 'end' : 'update',
      props: this.props(r.startedAt, r.locale, counts, ended),
      ...(ended
        ? { dismissalDate: immediate ? 0 : now + LIVE_ACTIVITY_DONE_MS / 1000 }
        : { staleDate: now + LIVE_ACTIVITY_STALE_MS / 1000 }),
    }
  }
  /** Notes a route that cannot send (Link with no Apple key), so the phone keeps its own updates meanwhile. */
  private refused(result: LiveActivityPushReply) {
    if (result.status === 401 || result.reason === LINK_UNAVAILABLE) this.unavailableUntil = Date.now() + LINK_RETRY_MS
  }
  async flush() {
    if (this.busy || !(await this.available())) return
    this.busy = true
    try {
      const devices = new Set(this.devices().map((d) => d.id)),
        counts = this.counts()
      const bounded = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(9999, Math.floor(value))) : 0)
      const normalized = { running: bounded(counts.running), needsInput: bounded(counts.needsInput) }
      const working = normalized.running + normalized.needsInput > 0
      if (!working) this.workingSince = 0
      else if (!this.workingSince) this.workingSince = Date.now()
      const signature = JSON.stringify(normalized)
      // A phone that showed an activity during this work is not started again in it, also after it swiped it away.
      if (working)
        for (const start of this.starts)
          if (this.registrations.some((r) => r.deviceId === start.deviceId)) start.startedFor = this.workingSince
      for (const r of [...this.registrations]) {
        const revoked = !devices.has(r.deviceId),
          expired = Date.now() - r.startedAt >= 8 * 60 * 60_000
        const ended = revoked || expired || !working
        if (!ended && r.signature === signature && Date.now() - (r.sentAt ?? 0) < 5 * 60_000) continue
        try {
          const result = await this.sender(this.push(r, normalized, ended, revoked || expired))
          this.refused(result)
          if (
            (ended && result.status === 200) ||
            revoked ||
            expired ||
            result.status === 410 ||
            result.reason === 'BadDeviceToken' ||
            result.reason === 'DeviceTokenNotForTopic'
          )
            this.registrations = this.registrations.filter((current) => current !== r)
          else if (result.status === 200) {
            r.sentAt = Date.now()
            r.signature = signature
          }
        } catch {
          if (revoked || expired) this.registrations = this.registrations.filter((current) => current !== r)
        }
      }
      await this.startActivities(devices, normalized)
      this.save()
    } finally {
      this.busy = false
    }
  }
  /**
   * Starts the Live Activity on phones that have none for this work, once per stretch of work and only after it has
   * gone on a little, so a phone with Ramu open starts its own and is not shown two.
   */
  private async startActivities(devices: Set<string>, counts: { running: number; needsInput: number }) {
    this.starts = this.starts.filter((s) => devices.has(s.deviceId))
    if (!this.workingSince) return
    const due = this.workingSince + START_DELAY_MS
    if (Date.now() < due) {
      if (this.starts.some((s) => s.startedFor !== this.workingSince)) this.schedule(due - Date.now() + 100)
      return
    }
    for (const s of [...this.starts]) {
      if (s.startedFor === this.workingSince || this.registrations.some((r) => r.deviceId === s.deviceId)) continue
      const now = Math.floor(Date.now() / 1000)
      try {
        const result = await this.sender({
          token: s.token,
          environment: s.environment,
          event: 'start',
          props: this.props(Date.now(), s.locale, counts, false),
          staleDate: now + LIVE_ACTIVITY_STALE_MS / 1000,
          computerId: s.computerId,
          alert: startAlert(s.locale, counts),
        })
        this.refused(result)
        if (result.status === 200) s.startedFor = this.workingSince
        else if (result.status === 410 || result.reason === 'BadDeviceToken')
          this.starts = this.starts.filter((current) => current !== s)
      } catch {}
    }
  }
  dispose() {
    if (this.timer) clearTimeout(this.timer)
  }
}
