import { verifyHost, learnedRoutes, type HostVerification } from '@ramu/shared/hostProof'

/** Keep the previous working route as well: a VPN may disappear while the phone returns to Wi-Fi. */
export function rememberRoutes(current: string, incoming: string[], previous: string[] = []): string[] {
  return learnedRoutes([current, ...incoming, ...previous])
}

/** No credential goes to a candidate until its challenge response proves the paired host's identity. */
export async function findHostRoute(input: {
  address: string
  routes: string[]
  signal: AbortSignal
  verify: (address: string, signal: AbortSignal) => Promise<HostVerification>
  /** After proof, confirm the route also carries the app's WebSocket, before changing the saved address. */
  usable?: (address: string, signal: AbortSignal) => Promise<boolean>
}): Promise<{ address: string; routes: string[] } | null> {
  const candidates = learnedRoutes(input.routes).filter((address) => {
    try {
      const url = new URL(address)
      return (
        url.origin === address &&
        !url.username &&
        !url.password &&
        address !== input.address &&
        !(input.address.startsWith('https:') && url.protocol === 'http:')
      )
    } catch {
      return false
    }
  })
  if (input.signal.aborted || !candidates.length) return null
  const controller = new AbortController()
  return new Promise((resolve) => {
    let settled = false
    let pending = candidates.length
    const finish = (result: { address: string; routes: string[] } | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.signal.removeEventListener('abort', abort)
      controller.abort()
      resolve(result)
    }
    const abort = () => finish(null)
    const timer = setTimeout(abort, 4000)
    input.signal.addEventListener('abort', abort, { once: true })
    // At most eight origins; one unreachable LAN interface cannot delay a reachable VPN.
    for (const address of candidates) {
      void Promise.resolve()
        .then(() =>
          controller.signal.aborted ? { state: 'unreachable' as const } : input.verify(address, controller.signal),
        )
        .then(async (result) => {
          if (result.state !== 'verified' || controller.signal.aborted) return
          if (input.usable && !(await input.usable(address, controller.signal))) return
          if (!controller.signal.aborted) finish({ address, routes: result.routes })
        })
        .catch(() => {})
        .finally(() => {
          if (--pending === 0) finish(null)
        })
    }
  })
}

export { verifyHost }
