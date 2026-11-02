// Bearer token for network clients. The unix socket is protected by its file mode; TCP has no such guarantee.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AUTH_SCHEME } from '@ramu/contracts'

const TOKEN_PATTERN = /^[a-f0-9]{64}$/

/** Reads the token, creating it on first use. Rotating invalidates every paired client. */
export function loadToken(path: string, rotate = false): string {
  if (!rotate && existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim()
    if (TOKEN_PATTERN.test(existing)) return existing
  }
  const token = randomBytes(32).toString('hex')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return token
}

export function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith(`${AUTH_SCHEME} `)) return false
  const given = Buffer.from(header.slice(AUTH_SCHEME.length + 1)),
    expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Reads the token file on every check (it is 65 bytes), so `ramu token --rotate` revokes paired clients without a restart. */
export class TokenStore {
  constructor(private readonly path: string) {
    this.current()
  }
  current(): string {
    return loadToken(this.path)
  }
}
