// Webhook requests reaching a schedule: the host's own listener (`POST /hooks/<token>`) hands the raw request here. The address token finds the schedule, the signature proves the sender, and the schedule decides the rest.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { MAX_WEBHOOK_BODY_BYTES, type WebhookRequest, type WebhookSignature } from '@ramu/shared/webhooks'
import type { WebhookDelivery } from '@ramu/shared/types'
import type { ScheduleService } from './schedules'

export const WEBHOOK_PATH = '/hooks/'
/** A sender retrying in a loop or a leaked address must not queue unbounded work or fill the log in seconds. */
const MAX_PER_MINUTE = 30
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/

const same = (a: string, b: string) => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Whether the request carries the signature the schedule's secret produces. No signature configured: always true. */
export function signatureMatches(
  signature: WebhookSignature | null,
  secret: string | null,
  headers: Record<string, string>,
  raw: Buffer,
): boolean {
  if (!signature) return true
  if (!secret) return false
  const sent = headers[signature.header.toLowerCase()] ?? ''
  if (signature.kind === 'token') return same(sent, secret)
  const digest = createHmac('sha256', secret).update(raw).digest(signature.encoding)
  return same(sent, `${signature.prefix}${digest}`)
}

/** JSON, or a form post's `payload` field (GitHub's form content type), or the text itself. */
export function parseBody(raw: Buffer, contentType: string | undefined): unknown {
  const text = raw.toString('utf8')
  if (/application\/x-www-form-urlencoded/i.test(contentType ?? '')) {
    const form = new URLSearchParams(text)
    const payload = form.get('payload')
    if (payload !== null)
      try {
        return JSON.parse(payload) as unknown
      } catch {}
    return Object.fromEntries(form)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Header names lower-cased, repeated headers joined, and credentials a proxy might add left out. */
export function cleanHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    if (value === undefined || key === 'authorization' || key === 'cookie') continue
    out[key] = (Array.isArray(value) ? value.join(', ') : value).slice(0, 4096)
  }
  return out
}

export type WebhookAnswer = { status: 202; delivery: WebhookDelivery } | { status: 404 | 413 | 429; error: string }

export class WebhookReceiver {
  private readonly recent = new Map<string, number[]>()
  constructor(private readonly schedules: ScheduleService) {}

  receive(
    token: string,
    headers: Record<string, string | string[] | undefined>,
    raw: Buffer,
    options: { now?: number } = {},
  ): WebhookAnswer {
    // An unknown address and a malformed one get the same answer, so addresses cannot be probed.
    const target = TOKEN.test(token) ? this.schedules.webhookTarget(token) : null
    if (!target || target.schedule.rule.kind !== 'webhook') return { status: 404, error: 'Not found' }
    if (raw.length > MAX_WEBHOOK_BODY_BYTES) return { status: 413, error: 'The request is too large' }
    const now = options.now ?? Date.now()
    const times = (this.recent.get(token) ?? []).filter((at) => now - at < 60_000)
    if (times.length >= MAX_PER_MINUTE) return { status: 429, error: 'Too many requests' }
    this.recent.set(token, [...times, now])
    const clean = cleanHeaders(headers)
    const request: WebhookRequest = { headers: clean, body: parseBody(raw, clean['content-type']) }
    const delivery = this.schedules.deliver(target.schedule, request, {
      signed: signatureMatches(target.schedule.rule.signature, target.secret, clean, raw),
      now,
    })
    return { status: 202, delivery }
  }
}

/** The exact bytes, for the signature; null once the body passes the limit (the rest is not read). */
export async function readWebhookBody(req: AsyncIterable<Buffer | string>): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const part = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += part.length
    if (size > MAX_WEBHOOK_BODY_BYTES) return null
    chunks.push(part)
  }
  return Buffer.concat(chunks)
}
