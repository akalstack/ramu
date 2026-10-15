import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { AgentEvent, AgentSessionInfo, ChatGoal } from '@ramu/shared/types'
interface Registration {
  deviceId: string
  token: string
  computerId: string
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
  private receipts = new Map<string, Registration>()
  constructor(
    private path: string,
    private devices: () => { id: string }[],
    private request: typeof fetch = fetch,
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
  register(deviceId: string, token: string, computerId: string) {
    if (!this.devices().some((d) => d.id === deviceId)) throw new Error('Pair this phone before registering push')
    if (
      !/^(ExponentPushToken|ExpoPushToken)\[[a-zA-Z0-9_-]{10,200}\]$/.test(token) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(computerId)
    )
      throw new Error('Invalid push registration')
    this.registrations = [...this.registrations.filter((r) => r.deviceId !== deviceId), { deviceId, token, computerId }]
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
  observe(session: AgentSessionInfo, event: AgentEvent, goal?: ChatGoal | null) {
    if (session.parentId) return
    let kind: 'done' | 'input' | 'failed' | undefined
    if (event.kind === 'state') {
      const previous = this.states.get(session.id)
      this.states.set(session.id, event.state)
      if (this.states.size > 5000) this.states.delete(this.states.keys().next().value!)
      if (previous && previous !== event.state) {
        if (
          event.state === 'idle' &&
          ['running', 'starting'].includes(previous) &&
          (!goal || !['active', 'waiting-provider', 'blocked'].includes(goal.status))
        )
          kind = 'done'
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
    this.prune()
    for (const registration of this.registrations) {
      const result = await this.request('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          to: registration.token,
          title: 'Ramu',
          body:
            kind === 'done'
              ? 'Agent work finished.'
              : kind === 'input'
                ? 'An agent needs your input.'
                : 'Agent work stopped with an error.',
          sound: 'default',
          data: { computerId: registration.computerId, taskId: session.taskId, sessionId: session.id, kind },
        }),
      })
      if (!result.ok) continue
      const { data } = (await result.json()) as { data: Ticket }
      if (data.details?.error === 'DeviceNotRegistered') this.remove(registration.deviceId)
      else if (data.id) this.receipts.set(data.id, registration)
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
