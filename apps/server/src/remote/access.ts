import type { IncomingMessage, ServerResponse } from 'node:http'
import { PAIR_PATH, PROTOCOL_VERSION } from '@ramu/contracts'
import { authorized } from './auth'
import type { DeviceInfo, DeviceStore } from './devices'

// Explicit allowlist: a new method never acquires viewer access by its spelling alone.
const viewerMethods = new Set([
  'background.status',
  'agent.all',
  'agent.list',
  'agent.get',
  'agent.events',
  'agent.snapshot',
  'agent.goal',
  'agent.context',
  'agent.checkpoint',
  'agent.counts',
  'agent.searchMessages',
  'agent.scope',
  'agent.catalog',
  'agent.providerHold',
  'agent.replyPermission',
  'agent.replyQuestion',
  'agent.replyElicitation',
  'agent.questionDraft',
  'agent.elicitationDraft',
  'agent.dismissQuestion',
  'settings.app.get',
  'settings.app.snapshot',
  'settings.models.get',
  'recaps.get',
  'summaries.get',
  'schedules.list',
  'schedules.runs',
  'projects.list',
  'repos.list',
  'tasks.list',
  'tasks.get',
  'tasks.bindings',
  'workspaces.list',
  'ui.get',
  'notices.list',
  'activity.status',
  'usage.get',
  'usage.accounts',
  'aside.list',
  'interactive.get',
  'interactive.list',
  'attachments.text',
  'attachments.preview',
  'reviews.list',
  'reviews.get',
  'reviews.branches',
  'reviews.inspect',
  'notifications.register',
  'notifications.unregister',
  'liveActivity.status',
  'liveActivity.register',
  'liveActivity.unregister',
])
export const deviceMayInvoke = (device: DeviceInfo | undefined, method: string): boolean =>
  device?.role !== 'viewer' || viewerMethods.has(method)

/** HTTP authentication shared by production and route tests. No cookies or implicit browser origins. */
export class RemoteAccess {
  private failures = new Map<string, { count: number; until: number; updatedAt: number }>()
  constructor(
    private options: {
      devices: DeviceStore
      legacyToken?: () => string
      browserOrigins: string[]
      now?: () => number
    },
  ) {}

  authorized(header: string | undefined): boolean {
    return (
      this.options.devices.authenticate(header) !== null ||
      Boolean(this.options.legacyToken && authorized(header, this.options.legacyToken()))
    )
  }

  /** undefined means this response has already been sent; null is a legacy authenticated client. */
  async accept(req: IncomingMessage, res: ServerResponse): Promise<DeviceInfo | null | undefined> {
    const origin = req.headers.origin
    if (origin) {
      if (!this.options.browserOrigins.includes(origin)) {
        res.writeHead(403).end()
        return
      }
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Ramu-Protocol')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(origin ? 204 : 403).end()
      return
    }
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/health' && req.method === 'GET') {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION }))
      return
    }
    const now = this.options.now?.() ?? Date.now()
    // Bound attacker-controlled keys, and forget inactive peers so a past failure is not a permanent penalty.
    for (const [peer, state] of this.failures) if (now - state.updatedAt > 15 * 60_000) this.failures.delete(peer)
    const peer = req.socket.remoteAddress ?? 'unknown'
    const limit = this.failures.get(peer)
    if (limit && limit.until > now) {
      res.writeHead(429, { 'Retry-After': String(Math.ceil((limit.until - now) / 1000)) }).end()
      return
    }
    const rejected = (message?: string) => {
      const count = Math.min(20, (limit?.count ?? 0) + 1)
      if (this.failures.size >= 4096 && !this.failures.has(peer))
        this.failures.delete(this.failures.keys().next().value!)
      this.failures.set(peer, {
        count,
        until: count >= 5 ? now + Math.min(60_000, 1000 * 2 ** (count - 5)) : 0,
        updatedAt: now,
      })
      res
        .writeHead(401, { 'Content-Type': 'application/json' })
        .end(message ? JSON.stringify({ error: message }) : undefined)
    }
    if (path === PAIR_PATH && req.method === 'POST') {
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 4096) {
          res.writeHead(413).end()
          return
        }
        chunks.push(chunk)
      }
      let request: { code?: unknown; name?: unknown }
      try {
        request = JSON.parse(Buffer.concat(chunks).toString() || '{}') ?? {}
      } catch {
        rejected('Invalid pairing request')
        return
      }
      const paired =
        typeof request.code === 'string'
          ? this.options.devices.redeem(request.code, typeof request.name === 'string' ? request.name : undefined, now)
          : null
      if (!paired) {
        rejected('That pairing code is wrong, already used or expired')
        return
      }
      this.failures.delete(peer)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(
        JSON.stringify({
          deviceId: paired.device.id,
          token: paired.token,
          role: paired.device.role,
          expiresAt: paired.device.expiresAt,
        }),
      )
      return
    }
    const device = this.options.devices.authenticate(req.headers.authorization, now)
    if (!device && !(this.options.legacyToken && authorized(req.headers.authorization, this.options.legacyToken()))) {
      rejected()
      return
    }
    this.failures.delete(peer)
    if (device) {
      res.setHeader('X-Ramu-Device-Role', device.role)
      if (device.expiresAt !== null) res.setHeader('X-Ramu-Token-Expires', String(device.expiresAt))
    }
    return device
  }
}
