// Paired devices for network clients. Each device holds its own token, so one lost phone is revoked without touching the rest.
// The file is read on every check, so `ramu devices revoke` takes effect without a restart. Only hashes are stored.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { AUTH_SCHEME } from '@ramu/contracts'

export const PAIRING_TTL_MS = 10 * 60_000
const MAX_PENDING = 5
const MAX_NAME = 60
// No 0/O/1/I/L, so a code read aloud or off a screen is not mistyped.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const DEVICE_TTL_MS = 90 * 24 * 60 * 60_000
export type DeviceRole = 'owner' | 'viewer'
const LAST_SEEN_WRITE_MS = 5 * 60_000

export interface DeviceInfo {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number | null
  expiresAt: number | null
  role: DeviceRole
}
interface DeviceRecord extends DeviceInfo {
  tokenHash: string
}
interface PendingCode {
  role?: DeviceRole
  codeHash: string
  expiresAt: number
}
interface DeviceFile {
  devices: DeviceRecord[]
  pending: PendingCode[]
  /** Chosen on the host in Settings. Absent means the server default (`RAMU_DEVICE_TOKEN_DAYS`, else 90 days). */
  lifetimeDays?: number | 'never'
}
export const MAX_LIFETIME_DAYS = 3650
export type DeviceLifetime = number | 'never'
export const validLifetime = (value: unknown): value is DeviceLifetime =>
  value === 'never' || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_LIFETIME_DAYS)

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
/** "k7qm2-x9rtd" and "K7QM2X9RTD" are the same code. */
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
const cleanName = (name: string | undefined) =>
  (name ?? '')
    // eslint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME) || 'Unnamed device'

export class DeviceStore {
  private readonly seen = new Map<string, number>()
  constructor(
    private readonly path: string,
    private readonly lifetimeMs: number | null = DEVICE_TTL_MS,
  ) {
    if (lifetimeMs !== null && (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0))
      throw new Error('Device lifetime must be positive milliseconds, or null for never')
  }

  private read(): DeviceFile {
    if (!existsSync(this.path)) return { devices: [], pending: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      return {
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        ...(validLifetime(parsed.lifetimeDays) ? { lifetimeDays: parsed.lifetimeDays } : {}),
      }
    } catch {
      return { devices: [], pending: [] }
    }
  }

  /** How long an unused device stays paired: the host's saved choice, else the server default. */
  private lifetimeOf(file: DeviceFile): number | null {
    if (file.lifetimeDays === undefined) return this.lifetimeMs
    return file.lifetimeDays === 'never' ? null : file.lifetimeDays * 86_400_000
  }

  /** The saved choice and the default it overrides, for Settings. */
  lifetime(): { days: DeviceLifetime; saved: boolean } {
    const file = this.read()
    if (file.lifetimeDays !== undefined) return { days: file.lifetimeDays, saved: true }
    return { days: this.lifetimeMs === null ? 'never' : Math.round(this.lifetimeMs / 86_400_000), saved: false }
  }

  /**
   * Changes how long devices stay paired. Each paired device picks it up the next time it connects (its expiry slides
   * with use); a device that is already expired stays expired. `null` goes back to the server default.
   */
  setLifetime(days: DeviceLifetime | null): void {
    if (days !== null && !validLifetime(days))
      throw new Error(`Lifetime must be 1 to ${MAX_LIFETIME_DAYS} days, or never`)
    const { lifetimeDays: _previous, ...rest } = this.read()
    this.write(days === null ? rest : { ...rest, lifetimeDays: days })
  }

  private write(file: DeviceFile) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(file, null, 2), { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, this.path)
  }

  /** A one-time code for a new device. The most recent few stay valid; older ones are dropped. */
  createCode(now = Date.now(), role: DeviceRole = 'owner'): { code: string; expiresAt: number } {
    if (role !== 'owner' && role !== 'viewer') throw new Error('Invalid device role')
    const file = this.read()
    const bytes = randomBytes(10)
    const raw = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
    const expiresAt = now + PAIRING_TTL_MS
    file.pending = [...file.pending.filter((p) => p.expiresAt > now), { codeHash: sha256(raw), expiresAt, role }].slice(
      -MAX_PENDING,
    )
    this.write(file)
    return { code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expiresAt }
  }

  /** Spends a code and creates the device in one write, so a code cannot be redeemed twice. Null when the code is wrong, used or expired. */
  redeem(code: string, name: string | undefined, now = Date.now()): { device: DeviceInfo; token: string } | null {
    const file = this.read(),
      hash = sha256(normalizeCode(code))
    const live = file.pending.filter((p) => p.expiresAt > now)
    const match = live.find((p) => p.codeHash === hash)
    if (!match) {
      if (live.length !== file.pending.length) this.write({ ...file, pending: live })
      return null
    }
    const token = randomBytes(32).toString('hex')
    const lifetime = this.lifetimeOf(file)
    const record: DeviceRecord = {
      id: randomUUID().slice(0, 8),
      name: cleanName(name),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: lifetime === null ? null : now + lifetime,
      role: match.role ?? 'owner',
      tokenHash: sha256(token),
    }
    this.write({ ...file, devices: [...file.devices, record], pending: live.filter((p) => p !== match) })
    return { device: strip(record), token }
  }

  /** The device that owns this Authorization header, or null. */
  authenticate(header: string | undefined, now = Date.now()): DeviceInfo | null {
    if (!header?.startsWith(`${AUTH_SCHEME} `)) return null
    const hash = sha256(header.slice(AUTH_SCHEME.length + 1))
    const file = this.read(),
      record = file.devices.find((d) => d.tokenHash === hash)
    if (!record) return null
    const lifetime = this.lifetimeOf(file)
    // Older records get a bounded migration window based on their last use, never an immortal grant.
    const expiry =
      record.expiresAt === undefined
        ? lifetime === null
          ? null
          : (record.lastSeenAt ?? record.createdAt) + lifetime
        : record.expiresAt
    if (expiry !== null && expiry <= now) return null
    // Remembered in memory and written rarely, so a busy client does not rewrite the file the CLI also edits.
    const lastWrite = this.seen.get(record.id) ?? 0
    if (now - lastWrite >= LAST_SEEN_WRITE_MS || record.expiresAt === undefined) {
      this.seen.set(record.id, now)
      record.lastSeenAt = now
      record.expiresAt = lifetime === null ? null : now + lifetime
      record.role ??= 'owner'
      this.write(file)
    }
    return strip(record)
  }

  list(): DeviceInfo[] {
    const file = this.read()
    const lifetime = this.lifetimeOf(file)
    return file.devices.map((record) =>
      strip({
        ...record,
        expiresAt:
          record.expiresAt === undefined
            ? lifetime === null
              ? null
              : (record.lastSeenAt ?? record.createdAt) + lifetime
            : record.expiresAt,
      }),
    )
  }
  /** Hash-derived key for signed availability announcements. Never sent to a client. */
  presenceKey(id: string): string | null {
    return this.read().devices.find((device) => device.id === id)?.tokenHash ?? null
  }

  /** Revokes by id, unique id prefix or "all". Returns the revoked devices. */
  revoke(target: string): DeviceInfo[] {
    const file = this.read()
    let matches = file.devices
    if (target !== 'all') {
      if (!target) throw new Error('Name a device id, or "all"')
      const exact = file.devices.filter((d) => d.id === target)
      matches = exact.length ? exact : file.devices.filter((d) => d.id.startsWith(target))
      if (matches.length > 1) throw new Error(`"${target}" matches ${matches.length} devices; use more of the id`)
    }
    const ids = new Set(matches.map((d) => d.id))
    if (ids.size) this.write({ ...file, devices: file.devices.filter((d) => !ids.has(d.id)) })
    for (const id of ids) this.seen.delete(id)
    return matches.map(strip)
  }
}

const strip = ({ id, name, createdAt, lastSeenAt, expiresAt, role }: DeviceRecord): DeviceInfo => ({
  id,
  name,
  createdAt,
  lastSeenAt,
  expiresAt,
  role: role ?? 'owner',
})
