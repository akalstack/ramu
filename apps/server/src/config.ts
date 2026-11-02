// Where the workspace server keeps its data and how clients reach it. Everything comes from the environment,
// so the same bundle runs under Electron's Node, a launchd/systemd unit, or a terminal.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runtimeSocket } from '@ramu/client-runtime'
import { isLoopbackHost } from '@ramu/contracts'
import { linkServiceUrl } from '@ramu/shared/link/protocol'

export interface ListenAddress {
  host: string
  port: number
}
export interface ServerConfig {
  userData: string
  deviceLifetimeMs: number | null
  browserOrigins: string[]
  socketPath: string
  /** Optional authenticated TCP listener for clients on other machines. */
  listen: ListenAddress | null
  /** Paired devices (per-device tokens and pending pairing codes). */
  devicesPath: string
  /** `--discoverable` / RAMU_DISCOVERABLE=1: advertise a command-line `--listen` to nearby devices. */
  discoverable: boolean
  /** Network access chosen in Settings; ignored when `listen` comes from the command line. */
  networkPath: string
  /** Certificate and key for serving the network listener over HTTPS. */
  tls: { cert: string; key: string } | null
  /** `RAMU_LINK_URL`: the Ramu Link service, overriding Settings. */
  linkService: string | null
}

/** The directory Electron uses for the desktop app, so a headless server and the desktop app share one profile. */
export function defaultUserData(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Ramu')
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Ramu')
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Ramu')
}

/** Accepts "7788", ":7788" or "host:port" (including "[::1]:7788"). A bare port binds loopback only. */
export function parseListen(value: string): ListenAddress {
  const match = /^(?:(\[[^\]]+\]|[^:]*):)?(\d{1,5})$/.exec(value.trim())
  if (!match) throw new Error(`Invalid listen address "${value}". Use PORT or HOST:PORT.`)
  const port = Number(match[2])
  if (port < 1 || port > 65535) throw new Error(`Invalid port ${port}`)
  return { host: (match[1] || '127.0.0.1').replace(/^\[|\]$/g, ''), port }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const userData = env.RAMU_USER_DATA || defaultUserData()
  const listen = env.RAMU_LISTEN ? parseListen(env.RAMU_LISTEN) : null
  if (!env.RAMU_TLS_CERT !== !env.RAMU_TLS_KEY)
    throw new Error('TLS needs both a certificate (--tls-cert) and a key (--tls-key).')
  const tls = env.RAMU_TLS_CERT && env.RAMU_TLS_KEY ? { cert: env.RAMU_TLS_CERT, key: env.RAMU_TLS_KEY } : null
  if (listen && !isLoopbackHost(listen.host) && !tls && env.RAMU_ALLOW_PLAINTEXT_REMOTE !== '1') {
    throw new Error(
      `Refusing to listen on ${listen.host}: traffic is not encrypted. Bind 127.0.0.1 and tunnel it (SSH, a TLS proxy), serve HTTPS with --tls-cert and --tls-key, or pass --private-network if every device that can reach this address is on a network you trust, such as a VPN (Tailscale, NetBird, ZeroTier, WireGuard).`,
    )
  }
  const lifetime = env.RAMU_DEVICE_TOKEN_DAYS ?? '90'
  const deviceLifetimeMs = lifetime === 'never' ? null : Number(lifetime) * 86_400_000
  if (deviceLifetimeMs !== null && (!Number.isSafeInteger(deviceLifetimeMs) || deviceLifetimeMs <= 0))
    throw new Error('RAMU_DEVICE_TOKEN_DAYS must be positive days, or never')
  const browserOrigins = (env.RAMU_BROWSER_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  for (const origin of browserOrigins) {
    const url = new URL(origin)
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin)
      throw new Error('RAMU_BROWSER_ORIGINS must contain exact HTTP(S) origins')
  }
  return {
    userData,
    deviceLifetimeMs,
    browserOrigins,
    socketPath: env.RAMU_SOCKET || runtimeSocket(userData),
    listen,
    tls,
    devicesPath: env.RAMU_DEVICES_FILE || join(userData, 'remote-devices.json'),
    networkPath: join(userData, 'network.json'),
    discoverable: env.RAMU_DISCOVERABLE === '1',
    linkService: env.RAMU_LINK_URL ? linkServiceUrl(env.RAMU_LINK_URL) : null,
  }
}
