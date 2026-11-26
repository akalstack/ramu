export interface BackgroundStatus {
  /** The computer's own name, offered as the default label when another device pairs with it. */ hostname?: string
  platform?: string
  protocol?: number
  capabilities?: string[]
  /** The asking device's own role. Absent means full access. Hiding actions supplements server checks. */
  access?: 'owner' | 'viewer'
  running: boolean
  pid: number
  startedAt: number
  /** Whether the service starts at login; the desktop adds it for the host on this computer. */
  loginEnabled?: boolean
  /** Whether this computer can start the service at login; the desktop adds it for its own host. */
  loginSupported?: boolean
  /**
   * Whether the service keeps running after the desktop app closes (the default); off, closing the app stops it. The
   * desktop adds it for its own host.
   */
  keepRunning?: boolean
  version?: string
  build?: string
  bundledVersion?: string
  bundledBuild?: string
  updateAvailable?: boolean
  /** `host:port` while the host accepts devices over the network; absent while it does not. */
  listening?: string
  /** Whether that listener serves HTTPS. */
  tls?: boolean
  /** What this host runs on. */
  os: DeviceOs
}

/** The `ramu` terminal command the desktop app puts on this computer, running the CLI that ships inside the app. */
export interface TerminalCommandStatus {
  /**
   * Why this app cannot install it: a development run, a copy whose path changes each launch (an AppImage, or a Mac app
   * opened straight from Downloads, which macOS runs from a random copy) or Windows.
   */
  unavailable?: 'development' | 'appimage' | 'translocated' | 'platform'
  installed: boolean
  /** Where the command is, or would be, written. */
  path: string
  /** Another program's `ramu` is already there; Ramu leaves it alone. */
  taken: boolean
  /** Whether new terminals find it: its folder is on the shell's PATH, or Ramu added it to the shell's profile. */
  onPath: boolean
}

/** What asking a host to update Ramu did. `built` means a supervisor-less host needs its service restarted by hand. */
export interface HostUpdateResult {
  outcome: 'current' | 'restarting' | 'built' | 'unavailable'
  version: string
  message: string
  /** The release page, when the person installs it themselves. */
  notesUrl?: string
}

/** A device that has paired with this computer's server and holds its own access token. */
/** What a device or host runs on, as it reports itself. Drives the icon and the line under its name. */
export interface DeviceOs {
  os: 'ios' | 'ipados' | 'android' | 'macos' | 'linux' | 'windows' | 'unknown'
  form: 'phone' | 'tablet' | 'computer' | 'server'
  /** OS version, such as `26.1` or `24.04.1 LTS`. */
  version?: string
  /** Linux only: the distribution's id from os-release (`ubuntu`, `debian`, `fedora`…) and its own name. */
  distro?: string
  distroName?: string
  /** The hardware, when the device names it (`iPhone 17 Pro`, `Pixel 10`). */
  model?: string
}

export interface NetworkDevice {
  id: string
  name: string
  /** The name the device paired with, present once it was renamed here, so the rename can be undone. */
  pairedName?: string
  createdAt: number
  expiresAt?: number | null
  role?: 'owner' | 'viewer'
  lastSeenAt: number | null
  /** What an owner device may use; absent on view-only devices. */
  permissions?: Partial<
    Record<import('../devicePermissions').DevicePermission, import('../devicePermissions').PermissionGrant>
  > /** Permissions the host refused for good. */
  blocked?: import('../devicePermissions').DevicePermission[]
  /** Another Ramu host whose agents start threads here, and nothing else. Absent for phones and desktops. */
  kind?: 'host'
  /** Hosts only: the most access their threads get here. */
  maxAccess?: 'edits' | 'auto' | 'full'
  /** The agent pairing that follows this device's Agents permission. Shown with the device, not as one of its own. */
  agentHost?: { id: string; maxAccess: 'edits' | 'auto' | 'full' }
  /** This device's own pairing lifetime, when it differs from the host's default. */
  lifetimeDays?: number | 'never'
  /** What the device runs on, once it described itself. */
  os?: DeviceOs
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
  /** How long an unused paired device stays paired. `saved` is false while the server default applies. */
  deviceLifetime: { days: number | 'never'; saved: boolean }
  /** Pairing offers not yet used, without their codes. */
  offers: { id: string; role: 'owner' | 'viewer'; expiresAt: number }[]
  /**
   * Nearby devices asking to pair while an offer is open, each with the six-digit code it shows. Approve only when the
   * codes match.
   */
  requests: { id: string; name: string; address: string; code: string; expiresAt: number }[]
  /** What a newly paired full-access device holds. */
  defaultPermissions: import('../devicePermissions').DevicePermission[]
  /** Paired devices asking for a permission, waiting for a person here. */
  permissionRequests: {
    id: string
    deviceId: string
    deviceName: string
    permission: import('../devicePermissions').DevicePermission
    at: number
  }[]
  /** Nearby-device discovery. */
  discovery: {
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
  /** The network listener is up, so devices beyond this computer can reach it. */
  reachable: boolean
  /**
   * The https:// address of a tunnel the person runs to this host, offered to paired devices and webhook senders first.
   * `command-line` means --public-url set it.
   */
  publicAddress?: { url: string | null; source: 'settings' | 'command-line' }
  /** A tunnel Ramu runs for this host, and which tools are installed for it. */
  tunnel?: {
    choice: TunnelChoice | null
    state: 'off' | 'starting' | 'running' | 'failed' | 'missing'
    url: string | null
    error: string | null
    tools: Record<'cloudflared' | 'tailscale' | 'ngrok', boolean>
    /** Ramu Link's state while it is the choice, or after it was refused (full, suspended). */
    link?: import('../ramuLink').LinkStatus | null
    /** The relay's pool as last fetched, so Settings can say a slot is free before anyone asks. */
    pool?: import('../ramuLink').LinkPool | null
  }
  /** The calling device's own id, when a paired device asks: it never removes itself by surprise in "Remove others". */
  self?: string
  /** Recent changes paired devices made to this host's devices, newest first, so the person here sees who did what. */
  changes?: DeviceChange[]
}
/** A change a paired device made to this host's devices, kept on the host and announced to the person there. */
export type DeviceChange = {
  id: string
  at: number
  /** The device that made it, by its id and the name this host lists it under then. */
  byId: string
  by: string
} & (
  | { action: 'removed'; deviceId: string; device: string }
  | { action: 'removedOthers'; count: number }
  | { action: 'renamed'; deviceId: string; device: string; name: string }
  | { action: 'connected'; deviceId: string; device: string; role: 'owner' | 'viewer' }
  | { action: 'declined'; device: string }
)
/**
 * A tunnel Ramu runs: Ramu Link (Ramu's relay, or one the person runs at `relay`), Cloudflare's quick tunnel, Tailscale
 * Funnel, or ngrok (with an optional static domain).
 */
export interface TunnelChoice {
  kind: 'link' | 'quick' | 'tailscale' | 'ngrok'
  domain?: string
  relay?: string
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
  /** A tunnel's https:// address, or null for none. Leave out to keep the saved one. */
  publicUrl?: string | null
}
/**
 * A paired computer inviting this host to connect back to it: the person there chose it, and the person here accepts by
 * connecting. It carries a one-time code for that computer, never a token of this host.
 */
export interface PairBackInvite {
  id: string
  /** The paired device that sent it. */
  deviceId: string
  /** That computer's name, as it introduces itself. */
  name: string
  /** Its addresses, tried in order. */
  urls: string[]
  code: string
  expiresAt: number
}
export interface PairingOffer {
  /** Non-secret handle for cancelling this offer or asking what became of it. */
  offerId: string
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
  /** Other addresses this host proved it answers on, to switch networks. Saved on this device. */
  routes?: string[]
  /** `manual` while the person keeps a route they chose; absent means this device picks the fastest that answers. */
  routeMode?: 'auto' | 'manual'
  /** The person allowed this host's unencrypted local network. */
  plainLan?: boolean
  /** The SSH target when this computer is reached through a tunnel. */
  ssh?: string
  /** The host's own id, which its listing on a Ramu account names; unknown for one paired before hosts said it. */
  hostId?: string
  status: ComputerStatus
  enabled?: boolean
  retryMode?: 'events' | 'periodic'
  waiting?: 'network' | 'computer'
  retryAt?: number
  /** Chats working, and chats waiting for you, on that computer. */
  running: number
  needsInput: number
  pairedAt: number | null
  /** The pairing code was accepted but the host has not answered a normal request since. The grant is kept. */
  grantedUnreachable?: boolean
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

/** Another Ramu host this host's agents may start threads on, as Settings and the CLI list it. Never its token. */
export interface AgentHostSummary {
  id: string
  name: string
  address: string
  /** This host's device id there, as that host's device list shows it. */
  deviceId: string
  expiresAt: number | null
  addedAt: number
}

/** What a host is called: the person's choice, or the computer's own name (`systemName`) when `custom` is false. */
export interface HostNameInfo {
  name: string
  systemName: string
  custom: boolean
  /** For a paired device asking: what this host calls it, and whether that differs from the name it paired with. */
  device?: { name: string; renamed: boolean }
}
