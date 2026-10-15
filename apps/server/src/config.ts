// Where the workspace server keeps its data and how clients reach it. Everything comes from the environment,
// so the same bundle runs under Electron's Node, a launchd/systemd unit, or a terminal.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runtimeSocket } from '@ramu/client-runtime'
import { isLoopbackHost } from '@ramu/contracts'

export interface ListenAddress {
  host: string
  port: number
}
export interface ServerConfig {
  userData: string
  socketPath: string
  /** Optional authenticated TCP listener for clients on other machines. */
  listen: ListenAddress | null
  tokenPath: string
  /** Paired devices (per-device tokens and pending pairing codes). */
  devicesPath: string
  /** Network access chosen in Settings; ignored when `listen` comes from the command line. */
  networkPath: string
  /** Certificate and key for serving the network listener over HTTPS. */
  tls: { cert: string; key: string } | null
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
  return {
    userData,
    socketPath: env.RAMU_SOCKET || runtimeSocket(userData),
    listen,
    tls,
    tokenPath: env.RAMU_TOKEN_FILE || join(userData, 'remote-token'),
    devicesPath: env.RAMU_DEVICES_FILE || join(userData, 'remote-devices.json'),
    networkPath: join(userData, 'network.json'),
  }
}
