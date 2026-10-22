export interface BackgroundStatus {
  /** The computer's own name, offered as the default label when another device pairs with it. */ hostname?: string
  platform?: string
  protocol?: number
  capabilities?: string[]
  /** The asking device's own role. Absent on older hosts, which means full access. Hiding actions supplements server checks. */
  access?: 'owner' | 'viewer'
  running: boolean
  pid: number
  startedAt: number
  loginEnabled: boolean
  version?: string
  build?: string
  bundledVersion?: string
  bundledBuild?: string
  updateAvailable?: boolean
}

/** A device that has paired with this computer's server and holds its own access token. */
export interface NetworkDevice {
  id: string
  name: string
  createdAt: number
  expiresAt?: number | null
  role?: 'owner' | 'viewer'
  lastSeenAt: number | null
}
/** An address this computer has, which another device may reach it on (LAN, VPN, ...). */
export interface NetworkAddress {
  name: string
  address: string
}
export interface NetworkStatus {
  /** Network access is switched on (it may not be listening yet; see `error`). */
  enabled: boolean
  listening: boolean
  host: string
  port: number
  /** `command-line` means --listen or RAMU_LISTEN set it, so Settings can show but not change it. */
  source: 'settings' | 'command-line'
  tls: boolean
  error: string | null
  addresses: NetworkAddress[]
  devices: NetworkDevice[]
  /** How long an unused paired device stays paired. `saved` is false while the server default applies. Absent on older hosts. */
  deviceLifetime?: { days: number | 'never'; saved: boolean }
  /** Pairing offers not yet used, without their codes. Absent on older hosts. */
  offers?: { id: string; role: 'owner' | 'viewer'; expiresAt: number }[]
  /** Nearby-device discovery. Absent on hosts that predate it. */
  discovery?: {
    /** The saved choice; it advertises only while network access is also on and listening. */
    discoverable: boolean
    state: 'off' | 'advertising' | 'unavailable'
    /** Interfaces being advertised on. */
    interfaces: string[]
    /** Short reason code when `unavailable`. */
    error: string | null
    /** Name nearby devices see. */
    name: string
  }
}
/** What became of one pairing offer. */
export type PairingOfferStatus =
  | { state: 'pending'; expiresAt: number; role: 'owner' | 'viewer' }
  | { state: 'redeemed'; device: NetworkDevice | null }
  | { state: 'cancelled' | 'expired' | 'unknown' }
export interface NetworkSettingsInput {
  enabled: boolean
  /** `0.0.0.0` / `::` for every network, or one of this computer's addresses. */
  host: string
  port: number
  /** Required to listen beyond this computer without TLS: the user accepts that Ramu does not encrypt the traffic. */
  acceptUnencrypted: boolean
  /** Let nearby devices see this host's name. Leave out to keep the saved choice. */
  discoverable?: boolean
}
export interface PairingOffer {
  /** Non-secret handle for cancelling this offer or asking what became of it. Absent on older hosts. */
  offerId?: string
  code: string
  expiresAt: number
  urls: { url: string; interface: string }[]
}
/**
 * `connecting`: reaching it now. `offline`: not answering; it keeps retrying. `rejected`: it no longer accepts this
 * device (revoked), so it has to be paired again. This computer is always `connected`.
 */
export type ComputerStatus = 'connecting' | 'connected' | 'offline' | 'rejected' | 'paused'
/** A computer whose Ramu this app is connected to: this one, or one it was paired with. Tokens stay in the main process. */
export interface Computer {
  /** `local` for the computer running this app. */
  id: string
  name: string
  local: boolean
  url: string | null
  /** The SSH target when this computer is reached through a tunnel. */
  ssh?: string
  status: ComputerStatus
  enabled?: boolean
  retryMode?: 'events' | 'periodic'
  waiting?: 'network' | 'computer'
  retryAt?: number
  /** Chats working, and chats waiting for you, on that computer. */
  running: number
  needsInput: number
  pairedAt: number | null
}
export interface Computers {
  /** Shared browsing filter. Null means all hosts; it never changes command routing. */
  scope?: string | null
  computers: Computer[]
  /** The computer the asking window belongs to. */
  current: string
  /** How this device names itself when pairing. */
  deviceName: string
}
