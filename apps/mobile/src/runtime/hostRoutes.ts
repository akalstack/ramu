import { verifyHost, learnedRoutes, type HostVerification } from '@ramu/shared/hostProof'

/** Keep the previous working route as well: a VPN may disappear while the phone returns to Wi-Fi. */
export function rememberRoutes(current: string, incoming: string[], previous: string[] = []): string[] {
  return learnedRoutes([current, ...incoming, ...previous])
}

/** Development only: Metro may already be reachable over the same computer's VPN before its API routes were learned.
 * This is an untrusted hint; findHostRoute must still prove the paired host before opening an authenticated connection.
 */
export function developmentHostRoute(address: string, bundleUrl?: string): string | null {
  if (!bundleUrl) return null
  try {
    const bundle = new URL(bundleUrl)
    const hostname = bundle.hostname.replace(/^\[|\]$/g, '')
    const privateAddress =
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(hostname) ||
      /^f[cd][0-9a-f]{2}:/i.test(hostname)
    if (!['http:', 'https:'].includes(bundle.protocol) || bundle.username || bundle.password || !privateAddress)
      return null
    const candidate = new URL(address)
    if (!['http:', 'https:'].includes(candidate.protocol)) return null
    candidate.hostname = bundle.hostname
    return candidate.origin === address ? null : candidate.origin
  } catch {
    return null
  }
}

/** No credential goes to a candidate until its challenge response proves the paired host's identity. */
export async function findHostRoute(input: {
  address: string
  routes: string[]
  /** Direct discovery also checks the saved address itself. */
  includeCurrent?: boolean
  /** Wait briefly for a preferred route instead of letting a faster LAN reply hide it. */
  prefer?: (address: string) => boolean
  signal: AbortSignal
  verify: (address: string, signal: AbortSignal) => Promise<HostVerification>
  /** After proof, confirm the route also carries the app's WebSocket, before changing the saved address. */
  usable?: (address: string, signal: AbortSignal) => Promise<boolean>
  /** Keeps the Ramu Link key a proven answer vouched for. */
  pinLinkKey?: (hostId: string, linkKey: string | undefined) => void
}): Promise<{ address: string; hostId: string; routes: string[] } | null> {
  const candidates = learnedRoutes(input.routes).filter((address) => {
    try {
      const url = new URL(address)
      return (
        url.origin === address &&
        !url.username &&
        !url.password &&
        (input.includeCurrent || address !== input.address) &&
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
    let preferredPending = candidates.filter((address) => input.prefer?.(address)).length
    let fallback: { address: string; hostId: string; routes: string[] } | null = null
    const finish = (result: { address: string; hostId: string; routes: string[] } | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.signal.removeEventListener('abort', abort)
      controller.abort()
      resolve(result)
    }
    const abort = () => finish(null)
    const timer = setTimeout(() => finish(fallback), 4000)
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
          if (controller.signal.aborted) return
          const found = { address, hostId: result.hostId, routes: result.routes }
          if (input.prefer?.(address) || !preferredPending) finish(found)
          else fallback ??= found
        })
        .catch(() => {})
        .finally(() => {
          if (input.prefer?.(address)) preferredPending--
          if (!preferredPending && fallback) finish(fallback)
          if (--pending === 0) finish(fallback)
        })
    }
  })
}

export { verifyHost }

/** NetBird and Tailscale IPv4 routes stay useful when the phone leaves the host's Wi-Fi. */
export function meshHostRoute(address: string): boolean {
  try {
    return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(new URL(address).hostname)
  } catch {
    return false
  }
}

/** Keep a working saved/manual choice. When it fails, prefer a verified mesh route among the alternatives. */
export async function chooseHostRoute(input: Parameters<typeof findHostRoute>[0]) {
  let learned: string[] = []
  let expectedHost: string | undefined
  const verify: typeof input.verify = async (address, signal) => {
    const result = await input.verify(address, signal)
    if (signal.aborted) return { state: 'unreachable' }
    if (result.state === 'verified') {
      if (expectedHost && result.hostId !== expectedHost) return { state: 'mismatch' }
      expectedHost = result.hostId
      input.pinLinkKey?.(result.hostId, result.linkKey)
      learned = learnedRoutes([...learned, ...result.routes])
    }
    return result
  }
  const current = await findHostRoute({ ...input, routes: [input.address], includeCurrent: true, verify })
  if (current || input.signal.aborted) return current
  return findHostRoute({
    ...input,
    routes: learnedRoutes([...input.routes, ...learned]),
    includeCurrent: false,
    prefer: meshHostRoute,
    verify,
  })
}
