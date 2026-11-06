import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { AgentEvent, AgentSessionInfo, ChatGoal } from '@ramu/shared/types'
import { createFinishedGate } from '@ramu/shared/chat/finishedGate'
/**
 * What a phone can switch on or off. `done` and `failed` cover ordinary threads; a thread started by a schedule that finishes
 * or fails counts as `scheduled` instead, so scheduled work can be muted on its own, and so does a scheduled run that could
 * not start a thread at all. `input` covers every thread. `digest` is the once-a-day "your recap is ready" note.
 */
export const PUSH_CATEGORIES = ['input', 'failed', 'done', 'scheduled', 'digest', 'artifacts'] as const
export type PushCategory = (typeof PUSH_CATEGORIES)[number]
/** Off until a phone asks for them: a registration that lists no categories does not get these. */
export const OPT_IN_CATEGORIES: readonly PushCategory[] = ['digest']
/** Where a tap on a push that is not about one thread goes; see `pushTarget` in the mobile app. */
export type PushTarget = 'schedules' | 'recaps' | 'artifact'
interface Registration {
  deviceId: string
  token: string
  computerId: string
  /** Absent means every category except the opt-in ones, as for phones registered before the switches existed. */
  categories?: PushCategory[]
}
interface Ticket {
  status: 'ok' | 'error'
  id?: string
  details?: { error?: string }
}
/** Opt-in Expo push registrations are owned by paired devices, never by shared bearer credentials. */
export class MobilePush {
  private registrations: Registration[] = []
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
  async deliver(session: AgentSessionInfo, kind: 'done' | 'input' | 'failed') {
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
  /** A scheduled run gave up before any thread existed, so there is nothing to open but the schedules. Generic text only. */
  async deliverScheduleFailure() {
    await this.send('scheduled', 'A scheduled run could not start.', (registration) => ({
      computerId: registration.computerId,
      kind: 'scheduled',
      target: 'schedules' satisfies PushTarget,
    }))
  }
  /** The once-a-day note that a recap is ready. No content, and only for phones that switched it on. */
  async deliverDigest() {
    await this.send('digest', 'Your daily recap is ready.', (registration) => ({
      computerId: registration.computerId,
      kind: 'digest',
      target: 'recaps' satisfies PushTarget,
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
    return registration.categories ? registration.categories.includes(category) : !OPT_IN_CATEGORIES.includes(category)
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
