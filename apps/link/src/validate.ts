// What a host may send. Everything is bounded: the relay is public, and the only thing a host chooses about its tunnel
// is the loopback port it reaches.
import { z } from 'zod'
import type { LinkRequest } from '@ramu/shared/ramuLink'

/** Larger bodies are refused before parsing. */
export const MAX_BODY_BYTES = 4 * 1024

const hostId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/)

export const linkRequest = z.object({
  hostId,
  name: z.string().trim().min(1).max(80),
  port: z.number().int().min(1).max(65_535),
  https: z.boolean(),
}) satisfies z.ZodType<LinkRequest>

export function parseHostId(value: string): string | null {
  const parsed = hostId.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The session token from `Authorization: Bearer …`, bounded so a huge header is not hashed or forwarded. */
export function bearerOf(header: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{8,512})$/.exec(header ?? '')
  return match?.[1] ?? null
}

/** Reads a JSON body of at most MAX_BODY_BYTES, or null when it is larger or not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_BODY_BYTES) return null
  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
