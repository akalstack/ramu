// Direct discovery complements multicast: only saved routes and the private development-computer hint are probed.
// A saved computer is recognized only by its device proof, never by its IP or an unauthenticated health response.
import { learnedRoutes } from '@ramu/shared/hostProof'
import { MAX_DISCOVERY_HOSTS } from '@ramu/shared/discovery/contract'
import type { NearbyHost } from '@ramu/shared/discovery/tracker'
import { findHostRoute, developmentHostRoute, verifyHost } from './hostRoutes'
import { checkHostConnection, operationKey, type Fetcher } from './transport'
import type { Computer } from './types'

export type ReachableHostProbe = (signal: AbortSignal, found: (host: NearbyHost) => void) => Promise<void>

export async function probeReachableHosts(input: {
  computers: readonly Computer[]
  bundleUrl?: string
  signal: AbortSignal
  tokenFor: (id: string) => Promise<string | null>
  fetch: Fetcher
  found: (host: NearbyHost) => void
  usable?: (address: string, token: string, signal: AbortSignal) => Promise<boolean>
}): Promise<void> {
  const computers = input.computers
    .filter((host) => host.deviceId && host.status !== 'revoked')
    .slice(0, MAX_DISCOVERY_HOSTS)
  let cursor = 0
  const pairedOrigins = new Set<string>()
  let developmentHost: NearbyHost | null = null
  const worker = async () => {
    while (!input.signal.aborted && cursor < computers.length) {
      const computer = computers[cursor++]!
      try {
        const token = await input.tokenFor(computer.id)
        if (!token || input.signal.aborted) continue
        const hint = developmentHostRoute(computer.address, input.bundleUrl)
        const verify = (address: string, signal: AbortSignal) =>
          verifyHost({
            fetch: input.fetch,
            baseUrl: address,
            deviceId: computer.deviceId!,
            token,
            expectedHostId: computer.hostId,
            challenge: operationKey(),
            signal,
          })
        const usable = (address: string, signal: AbortSignal) =>
          input.usable ? input.usable(address, token, signal) : checkHostConnection(address, token, input.fetch, signal)
        const candidates = [...(hint ? [hint] : []), computer.address, ...(computer.routes ?? [])]
        const check = (routes: string[]) =>
          findHostRoute({
            address: computer.address,
            includeCurrent: true,
            routes,
            signal: input.signal,
            verify,
            usable,
          })
        const first = await check(candidates)
        if (!first || input.signal.aborted) continue
        const routes = new Set<string>()
        const publish = (result: NonNullable<typeof first>) => {
          if (input.signal.aborted || result.hostId !== first.hostId) return
          pairedOrigins.add(result.address)
          for (const route of result.routes) pairedOrigins.add(route)
          routes.add(result.address)
          const scheme = new URL(result.address).protocol === 'https:' ? 'https' : 'http'
          input.found({
            key: `paired:${computer.id}:${scheme}`,
            hostId: result.hostId,
            name: computer.name,
            label: computer.name,
            scheme,
            routes: [...routes]
              .filter((url) => new URL(url).protocol === `${scheme}:`)
              .map((url) => ({ url, interfaceName: null })),
            pairedHostId: computer.id,
          })
        }
        // Show the first reachable route immediately, then retain every other proven interface instead of hiding it.
        publish(first)
        const alternatives = learnedRoutes([...first.routes, ...candidates]).filter((url) => url !== first.address)
        await Promise.all(
          alternatives.map(async (address) => {
            const result = await check([address])
            if (result) publish(result)
          }),
        )
      } catch {
        // One sleeping or revoked host cannot hide the others.
      }
    }
  }
  // Also list a new development computer when its private API health endpoint answers. Pairing still requires its code.
  const development = async () => {
    const address = developmentHostRoute('http://127.0.0.1:7788', input.bundleUrl)
    if (!address || input.signal.aborted) return
    const controller = new AbortController()
    let end!: () => void
    const deadline = new Promise<void>((resolve) => {
      end = resolve
    })
    const abort = () => {
      controller.abort()
      end()
    }
    input.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 4000)
    try {
      const request = async () => {
        const response = await input.fetch(`${address}/health`, { signal: controller.signal })
        if (!response.ok) return
        const body = await response.json()
        if (!body || body.ok !== true || body.protocol !== 1 || input.signal.aborted || controller.signal.aborted)
          return
        const hostname = new URL(address).hostname
        developmentHost = {
          key: `development:${address}`,
          hostId: '',
          name: hostname,
          label: hostname,
          scheme: 'http',
          routes: [{ url: address, interfaceName: null }],
          pairedHostId: null,
        }
      }
      await Promise.race([request(), deadline])
    } catch {
    } finally {
      clearTimeout(timer)
      input.signal.removeEventListener('abort', abort)
      abort()
    }
  }
  await Promise.all([development(), ...Array.from({ length: Math.min(3, computers.length) }, worker)])
  // A fast health reply must not briefly offer a second pairing for a host whose device proof is still arriving.
  const candidate = developmentHost as NearbyHost | null
  if (candidate && !input.signal.aborted && !pairedOrigins.has(candidate.routes[0]!.url)) input.found(candidate)
}
