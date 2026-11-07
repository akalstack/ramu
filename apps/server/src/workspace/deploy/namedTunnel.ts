// A lasting address for an app run on this computer: a Cloudflare Tunnel that Ramu configures through the person's own
// Cloudflare token, so the app keeps one hostname across restarts instead of a new quick-tunnel address each time.
// The tunnel's ingress names exactly that hostname and one loopback port and ends in a catch-all 404, so nothing else
// on this computer is reachable through it; Ramu's own port, wildcard hostnames and sockets are refused.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import { apexOf } from '@ramu/shared/domains'
import { HostCredentialStore } from '../../credentials/store'
import { findExecutable } from '../../providers/providerBinaries'
import { SavedCredential } from '../forge/savedCredential'
import { platformCall } from './adapter'

const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/

export interface LastingAddress {
  hostname: string
  port: number
}

interface Saved extends LastingAddress {
  /** The person's Cloudflare API token, kept to remove the tunnel and its record later. */
  token: string
  /** The tunnel's own token, which `cloudflared tunnel run` takes. */
  tunnelToken: string
  accountId: string
  zoneId: string
  tunnelId: string
  recordId: string
}

type State = ConstructorParameters<typeof SavedCredential>[1]
type SetState = ConstructorParameters<typeof SavedCredential>[2]

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })

export class LastingAddresses {
  constructor(
    private readonly deps: {
      getState: State
      setState: SetState
      credentials?: HostCredentialStore
      fetch?: typeof fetch
      api?: string
      /** Ports the tunnel must never reach: Ramu's own listener. */
      reserved: () => number[]
      freePort?: () => Promise<number>
    },
  ) {}

  private saved(projectId: string) {
    return new SavedCredential<Saved>(
      { key: `lasting-address-${projectId}`, connectionId: `lasting-address-${projectId}`, shown: 'hostname' },
      this.deps.getState,
      this.deps.setState,
      this.deps.credentials,
    )
  }

  private call<T>(token: string, path: string, what: string, init: RequestInit = {}) {
    return platformCall<{ result: T }>(
      'Cloudflare',
      this.deps.fetch ?? fetch,
      `${this.deps.api ?? 'https://api.cloudflare.com/client/v4'}${path}`,
      { ...init, token },
      what,
    ).then((reply) => reply.result)
  }

  /** The project's lasting hostname, without reading any secret. */
  hostname(projectId: string): string | null {
    return this.saved(projectId).savedField()?.shown ?? null
  }

  /** The hostname, port and tunnel token the app runs behind, or null when the project has no lasting address. */
  async address(projectId: string): Promise<(LastingAddress & { tunnelToken: string }) | null> {
    const saved = await this.saved(projectId).read()
    return saved ? { hostname: saved.hostname, port: saved.port, tunnelToken: saved.tunnelToken } : null
  }

  /**
   * Makes the tunnel and its DNS record on the person's Cloudflare account: the tunnel answers only `hostname`, at one
   * loopback port of this computer, and everything else with 404.
   */
  async set(projectId: string, input: { hostname: string; token: string }): Promise<LastingAddress> {
    const hostname = input.hostname.trim().toLowerCase().replace(/\.$/, '')
    if (!HOSTNAME.test(hostname))
      throw new Error('Enter one hostname, such as app.example.com; a wildcard or an address is not allowed.')
    const token = input.token.trim()
    if (await this.saved(projectId).read()) await this.remove(projectId)
    const [account] = await this.call<{ id: string }[]>(token, '/accounts', 'reading the account')
    if (!account) throw new Error('This Cloudflare token reaches no account.')
    const [zone] = await this.call<{ id: string }[]>(
      token,
      `/zones?name=${encodeURIComponent(apexOf(hostname))}`,
      'finding the domain',
    )
    if (!zone) throw new Error(`${apexOf(hostname)} is not a domain on this Cloudflare account.`)
    let port = await (this.deps.freePort ?? freePort)()
    while (this.deps.reserved().includes(port)) port = await (this.deps.freePort ?? freePort)()
    const tunnel = await this.call<{ id: string }>(token, `/accounts/${account.id}/cfd_tunnel`, 'creating the tunnel', {
      method: 'POST',
      body: JSON.stringify({ name: `ramu-${hostname}`, config_src: 'cloudflare' }),
    })
    await this.call(token, `/accounts/${account.id}/cfd_tunnel/${tunnel.id}/configurations`, 'routing the tunnel', {
      method: 'PUT',
      body: JSON.stringify({
        config: { ingress: [{ hostname, service: `http://127.0.0.1:${port}` }, { service: 'http_status:404' }] },
      }),
    })
    const record = await this.call<{ id: string }>(token, `/zones/${zone.id}/dns_records`, 'adding the DNS record', {
      method: 'POST',
      body: JSON.stringify({ type: 'CNAME', name: hostname, content: `${tunnel.id}.cfargotunnel.com`, proxied: true }),
    })
    const tunnelToken = await this.call<string>(
      token,
      `/accounts/${account.id}/cfd_tunnel/${tunnel.id}/token`,
      'reading the tunnel token',
    )
    await this.saved(projectId).save({
      hostname,
      port,
      token,
      tunnelToken,
      accountId: account.id,
      zoneId: zone.id,
      tunnelId: tunnel.id,
      recordId: record.id,
    })
    return { hostname, port }
  }

  /** Removes the DNS record and the tunnel, then forgets them; a part already gone is skipped. */
  async remove(projectId: string): Promise<void> {
    const saved = await this.saved(projectId).read()
    if (!saved) return
    await this.call(saved.token, `/zones/${saved.zoneId}/dns_records/${saved.recordId}`, 'removing the record', {
      method: 'DELETE',
    }).catch(() => {})
    await this.call(saved.token, `/accounts/${saved.accountId}/cfd_tunnel/${saved.tunnelId}`, 'removing the tunnel', {
      method: 'DELETE',
    }).catch(() => {})
    await this.saved(projectId).remove()
  }
}

/**
 * Runs `cloudflared tunnel run` with a tunnel's own token, in the shape the local apps expect of a tunnel. The address
 * is the lasting hostname, known before the tunnel connects.
 */
export class NamedTunnel {
  private child?: ChildProcess
  private failed: string | null = null

  constructor(
    private readonly lasting: LastingAddress & { tunnelToken: string },
    private readonly changed: () => void = () => {},
    private readonly run: (file: string, args: string[], env: Record<string, string>) => ChildProcess = (
      file,
      args,
      env,
    ) => spawn(file, args, { env, stdio: ['ignore', 'ignore', 'pipe'] }),
  ) {}

  use(): void {
    if (this.child) return
    const cloudflared = findExecutable('cloudflared')
    if (!cloudflared) {
      this.failed = 'Install cloudflared (Cloudflare’s tunnel tool) to use a lasting address.'
      return this.changed()
    }
    // The token goes in the environment, not on the command line where other users could read it.
    this.child = this.run(cloudflared, ['tunnel', '--no-autoupdate', 'run'], {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TUNNEL_TOKEN: this.lasting.tunnelToken,
    })
    this.child.once('exit', (code) => {
      this.child = undefined
      if (code) this.failed = 'The tunnel stopped. Check that the token is still valid, then publish again.'
      this.changed()
    })
  }

  stop(): void {
    this.child?.kill()
    this.child = undefined
  }

  status(): { state: 'running' | 'failed'; error: string | null } {
    return { state: this.failed ? 'failed' : 'running', error: this.failed }
  }

  address(): string {
    return `https://${this.lasting.hostname}`
  }
}
