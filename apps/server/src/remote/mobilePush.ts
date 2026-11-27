import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { AgentEvent, AgentSessionInfo, ChatGoal } from '@ramu/shared/types'
import { createFinishedGate } from '@ramu/shared/chat/finishedGate'
/**
 * What a phone can switch on or off. `done` and `failed` cover ordinary threads; a thread started by a schedule that finishes
 * or fails counts as `scheduled` instead, so scheduled work can be muted on its own, and so does a scheduled run that could
 * not start a thread at all. `input` covers every thread.
 */
export const PUSH_CATEGORIES = ['input', 'failed', 'done', 'scheduled', 'artifacts'] as const
export type PushCategory = (typeof PUSH_CATEGORIES)[number]
/** Where a tap on a push that is not about one thread goes; see `pushTarget` in the mobile app. */
export type PushTarget = 'schedules' | 'artifact'
interface Registration {
  deviceId: string
  token: string
  computerId: string
  /** Absent while the phone keeps every choice at its default: every category except the opt-in ones. */
  categories?: PushCategory[]
}
interface Ticket {
  status: 'ok' | 'error'
  id?: string
  details?: { error?: string }
}
/** Opt-in Expo push registrations are owned by paired devices, never by shared bearer credentials. */
/**
 * How long a device's word that it shows a thread holds without being repeated. Devices repeat it every minute while
 * the thread stays in front, so one that went away without saying so stops counting soon after.
 */
const VIEWING_MS = 90_000

export class MobilePush {
  private registrations: Registration[] = []
  private viewers = new Map<string, { sessions: Set<string>; present: boolean; at: number }>()
  private states = new Map<string, string>()
  private questions = new Set<string>()
  private finished = createFinishedGate()
  private receipts = new Map<string, Registration>()
  constructor(
    private path: string,
    private devices: () => { id: string }[],
    private request: typeof fetch = fetch,
    private isScheduled: (sessionId: string) => boolean = () => false,
  ) {
    try {
      this.registrations = JSON.parse(readFileSync(path, 'utf8'))
    } catch {}
  }
  private save() {
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify(this.registrations), { mode: 0o600 })
    renameSync(temp, this.path)
  }
  register(deviceId: string, token: string, computerId: string, categories?: unknown) {
    if (!this.devices().some((d) => d.id === deviceId)) throw new Error('Pair this phone before registering push')
    if (
      !/^(ExponentPushToken|ExpoPushToken)\[[a-zA-Z0-9_-]{10,200}\]$/.test(token) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(computerId)
    )
      throw new Error('Invalid push registration')
    const chosen = Array.isArray(categories)
      ? PUSH_CATEGORIES.filter((category) => (categories as unknown[]).includes(category))
      : undefined
    this.registrations = [
      ...this.registrations.filter((r) => r.deviceId !== deviceId),
      { deviceId, token, computerId, ...(chosen ? { categories: chosen } : {}) },
    ]
    this.save()
  }
  remove(deviceId: string) {
    this.registrations = this.registrations.filter((r) => r.deviceId !== deviceId)
    this.save()
  }
  prune() {
    const devices = new Set(this.devices().map((d) => d.id))
    const valid = this.registrations.filter((r) => devices.has(r.deviceId))
    if (valid.length !== this.registrations.length) {
      this.registrations = valid
      this.save()
    }
  }
  observe(session: AgentSessionInfo, event: AgentEvent, goal?: ChatGoal | null, helpers = 0) {
    if (session.parentId) return
    let kind: 'done' | 'input' | 'failed' | undefined
    if (event.kind === 'state') {
      const previous = this.states.get(session.id)
      this.states.set(session.id, event.state)
      if (this.states.size > 5000) this.states.delete(this.states.keys().next().value!)
      // A continuing or blocked goal, or helpers still running, is not a finished thread.
      if (
        this.finished.settle(session.id, event.state, {
          turnEnded: !!previous && ['running', 'starting'].includes(previous),
          goal,
          helpers,
        })
      )
        kind = 'done'
      if (previous && previous !== event.state) {
        if (event.state === 'needs-input') kind = 'input'
        if (event.state === 'failed') kind = 'failed'
      }
    } else if (
      event.kind === 'question' &&
      event.responseMode === 'message' &&
      !this.questions.has(`${session.id}:${event.requestId}`)
    ) {
      this.questions.add(`${session.id}:${event.requestId}`)
      kind = 'input'
      if (this.questions.size > 500) this.questions.delete(this.questions.values().next().value!)
    } else if (event.kind === 'goal' && event.goal && ['blocked', 'turn-limit'].includes(event.goal.status))
      kind = 'input'
    // A usage limit reset while auto-resume is off: nothing continues the thread, so the user is told once to resume it.
    else if (event.kind === 'provider-wait' && event.retryAt !== null && event.resetNotifiedAt !== undefined)
      kind = 'input'
    if (kind) void this.deliver(session, kind).catch(() => {})
  }
  private headers() {
    return {
      'Content-Type': 'application/json',
      ...(process.env.RAMU_EXPO_PUSH_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.RAMU_EXPO_PUSH_ACCESS_TOKEN}` }
        : {}),
    }
  }
  /**
   * The threads a device (a phone, this host's desktop or another desktop) has in front of the person right now; an
   * empty list when it has none, such as when it went to the background or lost focus. `present` says the person is
   * using that app, whatever it shows.
   */
  viewing(viewer: string, sessionIds: readonly string[], present = false) {
    if (!sessionIds.length && !present) this.viewers.delete(viewer)
    else this.viewers.set(viewer, { sessions: new Set(sessionIds.slice(0, 20)), present, at: Date.now() })
    if (this.viewers.size > 200) this.viewers.delete(this.viewers.keys().next().value!)
  }
  /**
   * Whether the person is using Ramu on a device other than `viewer` right now: a desktop app in front or the phone app
   * open. That device shows the news itself, so `viewer` raises no system notification of its own.
   */
  presentElsewhere(viewer: string) {
    const now = Date.now()
    for (const [other, { present, at }] of this.viewers)
      if (other !== viewer && present && now - at <= VIEWING_MS) return true
    return false
  }
  /** Whether the person is looking at this thread on some device, so a push about it would only repeat what they see. */
  private watched(sessionId: string) {
    const now = Date.now()
    for (const [viewer, { sessions, present, at }] of this.viewers) {
      if (now - at > VIEWING_MS) this.viewers.delete(viewer)
      // Someone using the desktop or phone app sees every thread's news there, in the app's own notifications.
      else if (present || sessions.has(sessionId)) return true
    }
    return false
  }
  async deliver(session: AgentSessionInfo, kind: 'done' | 'input' | 'failed') {
    if (this.watched(session.id)) return
    const category: PushCategory = kind !== 'input' && this.isScheduled(session.id) ? 'scheduled' : kind
    await this.send(
      category,
      kind === 'done'
        ? 'Agent work finished.'
        : kind === 'input'
          ? 'An agent needs your input.'
          : 'Agent work stopped with an error.',
      (registration) => ({
        computerId: registration.computerId,
        taskId: session.taskId,
        sessionId: session.id,
        kind,
      }),
    )
  }
  /** A watched live address stopped answering and an incident thread opened. Generic text; the tap opens the thread. */
  async deliverIncident(thread: { taskId: string; sessionId: string }) {
    await this.send('failed', 'Your live app stopped answering. Ramu opened a thread about it.', (registration) => ({
      computerId: registration.computerId,
      taskId: thread.taskId,
      sessionId: thread.sessionId,
      kind: 'failed',
    }))
  }
  /** A scheduled run gave up before any thread existed, so there is nothing to open but the schedules. Generic text only. */
  async deliverScheduleFailure() {
    await this.send('scheduled', 'A scheduled run could not start.', (registration) => ({
      computerId: registration.computerId,
      kind: 'scheduled',
      target: 'schedules' satisfies PushTarget,
    }))
  }
  /**
   * A notification an artifact sends, with the words it chose. The person allowed this artifact to notify, and the grant
   * sheet says the text travels through the phone's push service; the tap opens the artifact.
   */
  async deliverArtifact(artifactId: string, title: string, body: string) {
    await this.send(
      'artifacts',
      body,
      (registration) => ({
        computerId: registration.computerId,
        kind: 'artifacts',
        target: 'artifact' satisfies PushTarget,
        artifactId,
      }),
      title,
    )
  }
  private wants(registration: Registration, category: PushCategory) {
    return registration.categories ? registration.categories.includes(category) : true
  }
  private async send(
    category: PushCategory,
    body: string,
    data: (registration: Registration) => Record<string, unknown>,
    title = 'Ramu',
  ) {
    this.prune()
    for (const registration of this.registrations) {
      if (!this.wants(registration, category)) continue
      const result = await this.request('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          to: registration.token,
          title,
          body,
          sound: 'default',
          data: data(registration),
        }),
      })
      if (!result.ok) continue
      const { data: ticket } = (await result.json()) as { data: Ticket }
      if (ticket.details?.error === 'DeviceNotRegistered') this.remove(registration.deviceId)
      else if (ticket.id) this.receipts.set(ticket.id, registration)
    }
  }
  async checkReceipts() {
    this.prune()
    const entries = [...this.receipts.entries()].slice(0, 100)
    if (!entries.length) return
    const response = await this.request('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ ids: entries.map(([id]) => id) }),
    })
    if (!response.ok) return
    const { data } = (await response.json()) as { data: Record<string, Ticket> }
    for (const [id, registration] of entries) {
      if (!data[id]) continue
      this.receipts.delete(id)
      if (data[id]?.details?.error === 'DeviceNotRegistered') this.remove(registration.deviceId)
    }
    if (this.receipts.size > 1000)
      for (const id of [...this.receipts.keys()].slice(0, this.receipts.size - 1000)) this.receipts.delete(id)
  }
}
