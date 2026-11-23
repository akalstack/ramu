// Paired devices for network clients. Each device holds its own token, so one lost phone is revoked without touching the rest.
// The file is read on every check, so `ramu devices revoke` takes effect without a restart. Only hashes are stored.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { AUTH_SCHEME } from '@ramu/contracts'
import {
  AUTOMATIC_PERMISSIONS,
  DEVICE_PERMISSIONS,
  permissionsFor,
  grantActive,
  isDevicePermission,
  type DevicePermission,
  type PermissionGrant,
  type PermissionSetting,
} from '@ramu/shared/devicePermissions'

export const PAIRING_TTL_MS = 10 * 60_000
/** Used by software moments after it is made, so it need not last as long as a code a person reads out. */
const AGENT_PAIRING_TTL_MS = 60_000
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
  /** What an owner device may use; absent on view-only devices and paired hosts. */
  permissions?: Partial<Record<DevicePermission, PermissionGrant>>
  /** Permissions the host refused for good; requests for them are declined without asking again. */
  blocked?: DevicePermission[]
  /**
   * Another Ramu host whose agents start threads here. It may only start, check and message the threads it started, and
   * list projects; it receives no events. Absent for phones and desktops.
   */
  kind?: 'host'
  /** The most access a thread a host pairing starts may have here, whatever it asks for. Hosts only; default edits. */
  maxAccess?: HostAccess
  /** How long this device stays paired without use, overriding the host's default; absent uses the default. */
  lifetimeDays?: number | 'never'
  /** The device's own OS, as it described itself when it connected. Absent until it does. */
  os?: import('@ramu/shared/types').DeviceOs
  /** The agent pairing that follows this device's Agents permission. */
  agentHost?: { id: string; maxAccess: HostAccess }
  /** The name the device gave itself when it paired, kept once it was renamed so the rename can be undone. */
  pairedName?: string
}
export type HostAccess = 'edits' | 'auto' | 'full'
export const isHostAccess = (value: unknown): value is HostAccess =>
  value === 'edits' || value === 'auto' || value === 'full'
/**
 * A grant whose credential never made an authenticated request is dropped after this long: the pairing response was lost
 * or the device could not save it, so nobody holds the token and the grant would otherwise sit in the list forever.
 */
export const ORPHAN_GRANT_MS = 7 * 24 * 60 * 60_000
/** A renewed token is accepted until the client first uses it; an unused one is dropped after this long. */
export const RENEWAL_PENDING_MS = 7 * 24 * 60 * 60_000
/** The replaced token keeps working briefly so requests already in flight finish. */
export const RENEWAL_OVERLAP_MS = 2 * 60_000
interface DeviceRecord extends DeviceInfo {
  tokenHash: string
  /** The device whose Agents permission this host pairing follows. Absent on one paired with a person's code. */
  agentsOf?: string
  /** Set when pairing redeems and cleared by the first authenticated request: nobody has proven they hold the token. */
  unclaimed?: true
  /** Issued by `renew` and not used yet; promoted on its first authenticated request. */
  nextTokenHash?: string
  nextIssuedAt?: number
  /** The token a promotion replaced, valid until `previousUntil`. */
  previousTokenHash?: string
  previousUntil?: number
}
interface PendingCode {
  /** Non-secret handle for listing, cancelling and following one offer. */
  id: string
  /** Who created it (a dialog or the CLI); a new offer from the same owner replaces its previous unused one. */
  owner?: string
  role?: DeviceRole
  codeHash: string
  expiresAt: number
  /** Made for this device's agents: it can only become a host pairing, which follows that device's Agents permission. */
  agentsOf?: string
}
/** How an offer ended, kept briefly so the host can show exactly which offer was used or cancelled. */
interface SettledOffer {
  id: string
  state: 'redeemed' | 'cancelled'
  at: number
  deviceId?: string
}
const SETTLED_KEEP = 20
const SETTLED_MS = 60 * 60_000
export type OfferStatus =
  | { state: 'pending'; expiresAt: number; role: DeviceRole }
  | { state: 'redeemed'; device: DeviceInfo | null }
  | { state: 'cancelled' }
  | { state: 'expired' }
  | { state: 'unknown' }
interface DeviceFile {
  devices: DeviceRecord[]
  pending: PendingCode[]
  settled?: SettledOffer[]
  /** Chosen on the host in Settings. Absent means the server default (`RAMU_DEVICE_TOKEN_DAYS`, else 90 days). */
  lifetimeDays?: number | 'never'
  /** What a newly paired full-access device holds. Absent means every permission. */
  defaultPermissions?: DevicePermission[]
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
        ...(Array.isArray(parsed.settled) ? { settled: parsed.settled } : {}),
        ...(validLifetime(parsed.lifetimeDays) ? { lifetimeDays: parsed.lifetimeDays } : {}),
        ...(Array.isArray(parsed.defaultPermissions)
          ? { defaultPermissions: parsed.defaultPermissions.filter(isDevicePermission) }
          : {}),
      }
    } catch {
      return { devices: [], pending: [] }
    }
  }

  /** How long an unused device stays paired: the host's saved choice, else the server default. */
  /** A device's own lifetime when one was chosen for it, else the host's. */
  private lifetimeFor(file: DeviceFile, record: Pick<DeviceInfo, 'lifetimeDays'>): number | null {
    if (record.lifetimeDays === undefined) return this.lifetimeOf(file)
    return record.lifetimeDays === 'never' ? null : record.lifetimeDays * 86_400_000
  }

  /**
   * Keeps one device paired for `days` without use, or forever, or by the host's default (`undefined`). The expiry is
   * worked out again from the device's last use, so shortening it can end a device that has been away longer.
   */
  setDeviceLifetime(id: string, days: number | 'never' | undefined): void {
    if (days !== undefined && days !== 'never' && !(Number.isInteger(days) && days >= 1 && days <= 3650))
      throw new Error('Choose between 1 and 3650 days, or never.')
    const file = this.read()
    const record = file.devices.find((entry) => entry.id === id)
    if (!record) throw new Error('That device is no longer paired')
    if (days === undefined) delete record.lifetimeDays
    else record.lifetimeDays = days
    const lifetime = this.lifetimeFor(file, record)
    record.expiresAt = lifetime === null ? null : (record.lastSeenAt ?? record.createdAt) + lifetime
    this.write(file)
  }

  /** Renames a paired device, or with `null` gives it back the name it paired with. */
  rename(id: string, name: string | null): DeviceInfo {
    const file = this.read()
    const record = file.devices.find((entry) => entry.id === id)
    if (!record) throw new Error('That device is no longer paired')
    const original = record.pairedName ?? record.name
    const chosen = name === null ? '' : cleanName(name)
    if (name === null || chosen === original || chosen === 'Unnamed device') {
      record.name = original
      delete record.pairedName
    } else {
      record.pairedName = original
      record.name = chosen
    }
    this.write(file)
    return this.list().find((entry) => entry.id === id)!
  }

  /** What a device says it runs on; written only when it changed, since devices describe themselves on every connect. */
  describe(id: string, os: import('@ramu/shared/types').DeviceOs): void {
    const file = this.read()
    const record = file.devices.find((entry) => entry.id === id)
    if (!record || JSON.stringify(record.os) === JSON.stringify(os)) return
    record.os = os
    // Now that the host knows it is a phone or tablet, what it picked up but cannot use is dropped.
    const offered = permissionsFor(os)
    if (record.permissions)
      record.permissions = Object.fromEntries(
        Object.entries(record.permissions).filter(([permission]) => offered.includes(permission as DevicePermission)),
      )
    if (record.blocked) record.blocked = record.blocked.filter((permission) => offered.includes(permission))
    this.write(file)
  }

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

  /** What a new full-access device holds when it pairs. */
  defaultPermissions(): DevicePermission[] {
    return this.read().defaultPermissions ?? [...AUTOMATIC_PERMISSIONS]
  }

  setDefaultPermissions(permissions: DevicePermission[]): void {
    if (!Array.isArray(permissions) || !permissions.every(isDevicePermission)) throw new Error('Invalid permissions')
    this.write({ ...this.read(), defaultPermissions: [...new Set(permissions)] })
  }

  /** Whether this device may use a permission now. A viewer or a paired host never may. */
  allows(id: string, permission: DevicePermission, now = Date.now()): boolean {
    const device = this.read().devices.find((entry) => entry.id === id)
    if (!device || device.role === 'viewer' || device.kind === 'host') return false
    // A grant a phone picked up, from the host's defaults or before it said what it is, counts for nothing.
    if (!permissionsFor(device.os).includes(permission)) return false
    return grantActive(device.permissions?.[permission], now)
  }

  /**
   * Whether a host pairing may act now. One made for a device's agents ends with that device's Agents permission, so
   * a grant that expires or is revoked also stops its agents. One paired with a person's code stands on its own.
   */
  hostPairingActive(device: DeviceInfo, now = Date.now()): boolean {
    const record = this.read().devices.find((entry) => entry.id === device.id)
    if (!record) return false
    return !record.agentsOf || this.allows(record.agentsOf, 'agents', now)
  }

  /**
   * A short-lived code for this device's computer to pair its agents. Replaces any earlier agent pairing of the device,
   * so turning agents off and on leaves one. The caller has already checked the Agents permission.
   */
  agentPairingCode(id: string, now = Date.now()): string {
    const file = this.read()
    const device = file.devices.find((entry) => entry.id === id)
    if (!device || device.role === 'viewer' || device.kind === 'host')
      throw new Error('Only a device with full access can pair its agents.')
    if (!permissionsFor(device.os).includes('agents'))
      throw new Error('A phone or tablet has no agents to pair. Pair the computer they run on.')
    this.write({
      ...file,
      devices: file.devices.filter((entry) => entry.agentsOf !== id),
      pending: file.pending.filter((offer) => offer.agentsOf !== id),
    })
    const { code, offerId } = this.createCode(now)
    const next = this.read()
    this.write({
      ...next,
      pending: next.pending.map((offer) =>
        offer.id === offerId ? { ...offer, agentsOf: id, expiresAt: now + AGENT_PAIRING_TTL_MS } : offer,
      ),
    })
    return code
  }

  /** What this device holds, as shown to it and in Settings. */
  permissionsOf(id: string, now = Date.now()): Record<DevicePermission, PermissionGrant | null> {
    const device = this.read().devices.find((entry) => entry.id === id)
    return Object.fromEntries(
      DEVICE_PERMISSIONS.map((permission) => {
        if (!device || device.role === 'viewer' || !permissionsFor(device.os).includes(permission))
          return [permission, null]
        const grant = device.permissions?.[permission]
        return [permission, grantActive(grant, now) ? grant! : null]
      }),
    ) as Record<DevicePermission, PermissionGrant | null>
  }

  /** Sets the most access threads a host pairing starts here may have. Host-only, like the rest of device administration. */
  setMaxAccess(id: string, access: HostAccess): void {
    if (!isHostAccess(access)) throw new Error('Invalid access')
    const file = this.read()
    const device = file.devices.find((entry) => entry.id === id)
    if (!device) throw new Error('That device is no longer paired')
    if (device.kind !== 'host') throw new Error('Only a paired host has an access ceiling.')
    this.write({
      ...file,
      devices: file.devices.map((entry) => (entry.id === id ? { ...entry, maxAccess: access } : entry)),
    })
  }

  /** Grants for a while or for good, or revokes. Host-only, like the rest of device administration. */
  setPermission(id: string, permission: DevicePermission, grant: PermissionGrant | null, now = Date.now()): void {
    if (!isDevicePermission(permission)) throw new Error('Invalid permission')
    const file = this.read()
    const device = file.devices.find((entry) => entry.id === id)
    if (!device) throw new Error('That device is no longer paired')
    if (device.role === 'viewer')
      throw new Error('A view-only device cannot hold permissions. Pair it with full access.')
    if (grant && !permissionsFor(device.os).includes(permission))
      throw new Error('Agents is for another computer. A phone or tablet has no agents of its own.')
    const current = device.permissions ?? {}
    const next = Object.fromEntries(
      Object.entries({ ...current, [permission]: grant }).filter(
        (entry): entry is [string, PermissionGrant] => !!entry[1] && grantActive(entry[1], now),
      ),
    )
    // The host allowing it itself lifts a "never".
    const blocked = grant ? device.blocked?.filter((entry) => entry !== permission) : device.blocked
    this.write({
      ...file,
      devices: file.devices.map((entry) =>
        entry.id === id
          ? { ...entry, permissions: next, ...(blocked?.length ? { blocked } : { blocked: undefined }) }
          : entry,
      ),
    })
  }

  /** Sets where a permission stands, as Settings does: allowed until revoked, ask first, or blocked. */
  setState(id: string, permission: DevicePermission, setting: PermissionSetting, now = Date.now()): void {
    if (setting === 'blocked') return this.block(id, permission)
    this.setPermission(id, permission, setting === 'allowed' ? { until: null } : null, now)
    if (setting === 'allowed' || !this.blocked(id).includes(permission)) return
    // Ask first lifts a block, so the device may request it again.
    const file = this.read()
    this.write({
      ...file,
      devices: file.devices.map((entry) => {
        if (entry.id !== id) return entry
        const blocked = entry.blocked?.filter((item) => item !== permission)
        return { ...entry, blocked: blocked?.length ? blocked : undefined }
      }),
    })
  }

  /** Refuses a permission for good: it is removed and further requests for it are declined without asking. */
  block(id: string, permission: DevicePermission): void {
    this.setPermission(id, permission, null)
    const file = this.read()
    this.write({
      ...file,
      devices: file.devices.map((entry) =>
        entry.id === id ? { ...entry, blocked: [...new Set([...(entry.blocked ?? []), permission])] } : entry,
      ),
    })
  }

  blocked(id: string): DevicePermission[] {
    return this.read().devices.find((entry) => entry.id === id)?.blocked ?? []
  }

  /** The device's last connection closed: what it was allowed once ends. */
  endSession(id: string): void {
    const file = this.read()
    const device = file.devices.find((entry) => entry.id === id)
    if (!device?.permissions || !Object.values(device.permissions).some((grant) => grant?.session)) return
    const kept = Object.fromEntries(Object.entries(device.permissions).filter(([, grant]) => !grant?.session))
    this.write({
      ...file,
      devices: file.devices.map((entry) => (entry.id === id ? { ...entry, permissions: kept } : entry)),
    })
  }

  private write(file: DeviceFile) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(file, null, 2), { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, this.path)
  }

  /** A one-time code for a new device. The most recent few stay valid; older ones are dropped. */
  createCode(
    now = Date.now(),
    role: DeviceRole = 'owner',
    owner?: string,
  ): { code: string; expiresAt: number; offerId: string } {
    if (role !== 'owner' && role !== 'viewer') throw new Error('Invalid device role')
    const file = this.read()
    const offerId = randomUUID().slice(0, 8)
    const replaced = owner ? file.pending.filter((p) => p.owner === owner) : []
    file.settled = this.settle(file, replaced, 'cancelled', now)
    if (owner) file.pending = file.pending.filter((p) => p.owner !== owner)
    // randomInt draws uniformly; reducing random bytes modulo the alphabet size would favor the first characters.
    const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    const expiresAt = now + PAIRING_TTL_MS
    file.pending = [
      ...file.pending.filter((p) => p.expiresAt > now),
      { id: offerId, ...(owner ? { owner } : {}), codeHash: sha256(raw), expiresAt, role },
    ].slice(-MAX_PENDING)
    this.write(file)
    return { code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expiresAt, offerId }
  }

  private settle(
    file: DeviceFile,
    offers: PendingCode[],
    state: SettledOffer['state'],
    now: number,
    deviceId?: string,
  ) {
    const added = offers.map((offer) => ({ id: offer.id, state, at: now, ...(deviceId ? { deviceId } : {}) }))
    return [...(file.settled ?? []).filter((entry) => now - entry.at < SETTLED_MS), ...added].slice(-SETTLED_KEEP)
  }

  /** Unused offers, without their codes. */
  offers(now = Date.now()): { id: string; role: DeviceRole; expiresAt: number }[] {
    return this.read().pending.flatMap((p) =>
      p.expiresAt > now ? [{ id: p.id, role: p.role ?? 'owner', expiresAt: p.expiresAt }] : [],
    )
  }

  /** Withdraws an unused offer. A used or expired one is left as it is. */
  cancelOffer(id: string, now = Date.now()): boolean {
    const file = this.read()
    const match = file.pending.filter((p) => p.id === id)
    if (!match.length) return false
    file.settled = this.settle(file, match, 'cancelled', now)
    file.pending = file.pending.filter((p) => p.id !== id)
    this.write(file)
    return true
  }

  /** What became of one offer, so the host reports that offer's own outcome rather than any new device. */
  offerStatus(id: string, now = Date.now()): OfferStatus {
    const file = this.read()
    const pending = file.pending.find((p) => p.id === id)
    if (pending)
      return pending.expiresAt > now
        ? { state: 'pending', expiresAt: pending.expiresAt, role: pending.role ?? 'owner' }
        : { state: 'expired' }
    const settled = file.settled?.find((entry) => entry.id === id)
    if (!settled) return { state: 'unknown' }
    if (settled.state === 'cancelled') return { state: 'cancelled' }
    const device = file.devices.find((d) => d.id === settled.deviceId)
    return { state: 'redeemed', device: device ? strip(device) : null }
  }

  /** Spends a code and creates the device in one write, so a code cannot be redeemed twice. Null when the code is wrong, used or expired. */
  redeem(
    code: string,
    name: string | undefined,
    now = Date.now(),
    kind?: 'host',
  ): { device: DeviceInfo; token: string } | null {
    const hash = sha256(normalizeCode(code))
    const token = randomBytes(32).toString('hex')
    const device = this.spend((p) => p.codeHash === hash, name, token, now, kind)
    return device ? { device, token } : null
  }

  /**
   * Spends an unused offer for a device that paired by request, whose token both sides derived from their key exchange.
   * The same single write as `redeem`, so a code and a request can never both use one offer.
   */
  redeemOffer(offerId: string, name: string | undefined, token: string, now = Date.now()): DeviceInfo | null {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('Invalid device token')
    return this.spend((p) => p.id === offerId, name, token, now)
  }

  private spend(
    matches: (offer: PendingCode) => boolean,
    name: string | undefined,
    token: string,
    now: number,
    kind?: 'host',
  ): DeviceInfo | null {
    const file = this.read()
    const live = file.pending.filter((p) => p.expiresAt > now)
    // A view-only code never becomes a host pairing, which can start threads.
    const match = live.find(
      (offer) =>
        matches(offer) &&
        !(kind === 'host' && offer.role === 'viewer') &&
        // A code made for agents never becomes a full-access device.
        !(offer.agentsOf && kind !== 'host'),
    )
    if (!match) {
      if (live.length !== file.pending.length) this.write({ ...file, pending: live })
      return null
    }
    const lifetime = this.lifetimeOf(file)
    const record: DeviceRecord = {
      id: randomUUID().slice(0, 8),
      name: cleanName(name),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: lifetime === null ? null : now + lifetime,
      role: match.role ?? 'owner',
      tokenHash: sha256(token),
      unclaimed: true,
      // A host pairing holds no device permissions: what it may do is fixed by its kind and access ceiling.
      ...(kind === 'host' ? { kind, maxAccess: 'edits' as const } : {}),
      ...(match.agentsOf ? { agentsOf: match.agentsOf } : {}),
      ...((match.role ?? 'owner') === 'owner' && kind !== 'host'
        ? {
            permissions: Object.fromEntries(
              (file.defaultPermissions ?? AUTOMATIC_PERMISSIONS).map((permission) => [permission, { until: null }]),
            ),
          }
        : {}),
    }
    this.write({
      ...file,
      devices: [...file.devices, record],
      pending: live.filter((p) => p !== match),
      settled: this.settle(file, [match], 'redeemed', now, record.id),
    })
    return strip(record)
  }

  /** The device that owns this Authorization header, or null. */
  authenticate(header: string | undefined, now = Date.now()): DeviceInfo | null {
    if (!header?.startsWith(`${AUTH_SCHEME} `)) return null
    const hash = sha256(header.slice(AUTH_SCHEME.length + 1))
    const file = this.dropOrphans(this.read(), now),
      record = file.devices.find(
        (d) =>
          d.tokenHash === hash ||
          (d.nextTokenHash === hash && now - (d.nextIssuedAt ?? 0) < RENEWAL_PENDING_MS) ||
          (d.previousTokenHash === hash && (d.previousUntil ?? 0) > now),
      )
    if (!record) return null
    const lifetime = this.lifetimeFor(file, record)
    // The first request that carries the token proves the device saved it.
    const claimed = record.unclaimed === true
    if (claimed) delete record.unclaimed
    const expiry = record.expiresAt
    if (expiry !== null && expiry <= now) return null
    // The first request with a renewed token proves the client saved it: the old token stops after a short overlap.
    const promote = record.nextTokenHash === hash
    if (promote) {
      record.previousTokenHash = record.tokenHash
      record.previousUntil = now + RENEWAL_OVERLAP_MS
      record.tokenHash = hash
      delete record.nextTokenHash
      delete record.nextIssuedAt
    }
    // Remembered in memory and written rarely, so a busy client does not rewrite the file the CLI also edits.
    const lastWrite = this.seen.get(record.id) ?? 0
    if (claimed || promote || now - lastWrite >= LAST_SEEN_WRITE_MS || record.expiresAt === undefined) {
      this.seen.set(record.id, now)
      record.lastSeenAt = now
      record.expiresAt = lifetime === null ? null : now + lifetime
      record.role ??= 'owner'
      this.write(file)
    }
    return strip(record)
  }

  /**
   * Issues a fresh token to the device that holds the current one. The current token keeps working until the new one
   * is used once, so a lost response only means asking again (a repeat replaces the unused token). A replaced token
   * is not accepted for renewal, and a revoked device cannot renew.
   */
  renew(header: string | undefined, now = Date.now()): { token: string; expiresAt: number | null } | null {
    if (!header?.startsWith(`${AUTH_SCHEME} `)) return null
    const hash = sha256(header.slice(AUTH_SCHEME.length + 1))
    const file = this.read()
    const record = file.devices.find((d) => d.tokenHash === hash)
    if (!record) return null
    const lifetime = this.lifetimeFor(file, record)
    const expiry = record.expiresAt === undefined ? null : record.expiresAt
    if (expiry !== null && expiry <= now) return null
    const token = randomBytes(32).toString('hex')
    record.nextTokenHash = sha256(token)
    record.nextIssuedAt = now
    record.expiresAt = lifetime === null ? null : now + lifetime
    this.write(file)
    return { token, expiresAt: record.expiresAt }
  }

  list(now = Date.now()): DeviceInfo[] {
    const file = this.dropOrphans(this.read(), now)
    return file.devices.map((record) => {
      const lifetime = this.lifetimeFor(file, record)
      return strip({
        ...record,
        expiresAt:
          record.expiresAt === undefined
            ? lifetime === null
              ? null
              : (record.lastSeenAt ?? record.createdAt) + lifetime
            : record.expiresAt,
      })
    })
  }
  /** Removes grants nobody ever used, so a lost pairing response does not leave a credential no one holds. */
  private dropOrphans(file: DeviceFile, now: number): DeviceFile {
    const kept = file.devices.filter((d) => !(d.unclaimed && now - d.createdAt >= ORPHAN_GRANT_MS))
    if (kept.length === file.devices.length) return file
    const next = { ...file, devices: kept }
    this.write(next)
    return next
  }

  /** Hash-derived key for signed availability announcements. Never sent to a client. */
  presenceKey(id: string): string | null {
    return this.read().devices.find((device) => device.id === id)?.tokenHash ?? null
  }

  /**
   * Every key a device may hold right now: the current token's, then a renewed token still waiting to be used and the
   * previous one during its overlap. A device that has not yet used its renewed token proves with that one, so the host
   * must be able to answer for it or the device could never reconnect to claim it.
   */
  presenceKeys(id: string, now = Date.now()): string[] {
    const record = this.read().devices.find((device) => device.id === id)
    if (!record) return []
    return [
      record.tokenHash,
      ...(record.nextTokenHash && now - (record.nextIssuedAt ?? 0) < RENEWAL_PENDING_MS ? [record.nextTokenHash] : []),
      ...(record.previousTokenHash && (record.previousUntil ?? 0) > now ? [record.previousTokenHash] : []),
    ]
  }

  /** Revokes by id, unique id prefix or "all". Returns the revoked devices. */
  /** Devices as a person thinks of them: an agent pairing is part of the device it follows. */
  panel(now = Date.now()): DeviceInfo[] {
    const records = this.read().devices
    const follows = new Map(records.flatMap((record) => (record.agentsOf ? [[record.id, record.agentsOf]] : [])))
    const all = this.list(now)
    return all
      .filter((device) => !follows.has(device.id))
      .map((device) => {
        const agents = all.find((entry) => follows.get(entry.id) === device.id)
        return agents ? { ...device, agentHost: { id: agents.id, maxAccess: agents.maxAccess ?? 'edits' } } : device
      })
  }

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
    for (const device of file.devices) if (device.agentsOf && ids.has(device.agentsOf)) ids.add(device.id)
    if (ids.size) this.write({ ...file, devices: file.devices.filter((d) => !ids.has(d.id)) })
    for (const id of ids) this.seen.delete(id)
    return file.devices.filter((device) => ids.has(device.id)).map(strip)
  }
}

const strip = ({
  id,
  name,
  createdAt,
  lastSeenAt,
  expiresAt,
  role,
  permissions,
  blocked,
  kind,
  maxAccess,
  lifetimeDays,
  os,
  pairedName,
}: DeviceRecord): DeviceInfo => ({
  ...(permissions ? { permissions } : {}),
  ...(pairedName ? { pairedName } : {}),
  ...(lifetimeDays !== undefined ? { lifetimeDays } : {}),
  ...(os ? { os } : {}),
  ...(blocked?.length ? { blocked } : {}),
  ...(kind === 'host' ? { kind, maxAccess: maxAccess ?? 'edits' } : {}),
  id,
  name,
  createdAt,
  lastSeenAt,
  expiresAt,
  role: role ?? 'owner',
})
