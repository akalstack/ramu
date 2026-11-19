// Nearby-host browsing on the phone through the Ramu-owned `RamuDiscovery` native module (Bonjour on iOS, NSD on
// Android). Saved routes and a private development-computer hint are also checked directly when multicast is unavailable.
// Browsing runs on this phone, not on a paired host. It starts only while the caller says so and stops on cleanup, so
// leaving the screen, changing method or backgrounding the app ends it. It lists hosts and never pairs.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { DISCOVERY_SERVICE, MAX_BROWSE_MS } from '@ramu/shared/discovery/contract'
import { DiscoveryTracker, type NearbyHostsState, type NearbyHost } from '@ramu/shared/discovery/tracker'
import type { ReachableHostProbe } from './reachableHosts'
import { sightingFromNative, mergeReachableHosts, type NativeSighting } from './nearbyModel'

interface Subscription {
  remove(): void
}
interface RamuDiscoveryNative {
  start(service: string, maxMs: number): Promise<void>
  stop(): Promise<void>
  addListener(event: 'onResult', listener: (result: NativeSighting) => void): Subscription
  addListener(event: 'onLost', listener: (event: { key: string }) => void): Subscription
  addListener(event: 'onError', listener: (event: { code?: string }) => void): Subscription
}

const nativeModule = (): RamuDiscoveryNative | null =>
  Platform.OS === 'web' ? null : requireOptionalNativeModule<RamuDiscoveryNative>('RamuDiscovery')

/** Whether this build can browse native local announcements. Direct checks do not require this module. */
export const nearbySupported = () => nativeModule() !== null

const IDLE: NearbyHostsState = { status: 'idle', hosts: [], timedOut: false }

export function useNearbyHosts(
  active: boolean,
  /** The saved host a pairing bound to an advertised id; a recognition hint, never a credential decision. */
  verifiedHost?: (hostId: string) => string | null,
  probeHosts?: ReachableHostProbe,
): { state: NearbyHostsState; retry: () => void } {
  const probe = useRef(probeHosts)
  probe.current = probeHosts
  const lookup = useRef(verifiedHost)
  lookup.current = verifiedHost
  const [state, setState] = useState<NearbyHostsState>(IDLE)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!active) {
      setState(IDLE)
      return
    }
    const native = nativeModule()
    if (!native && !probe.current) {
      setState({ status: 'unavailable', hosts: [], timedOut: false })
      return
    }
    const tracker = new DiscoveryTracker({ verifiedHost: (hostId) => lookup.current?.(hostId) ?? null })
    const session = tracker.begin()
    const controller = new AbortController()
    let reachable = new Map<string, NearbyHost>()
    let previous: NearbyHost[] = []
    let nativeStatus: NearbyHostsState['status'] = 'searching'
    let nativeFailed = false
    let probing = false
    const publish = () => {
      if (!tracker.accepts(session)) return
      const hosts = mergeReachableHosts(tracker.hosts(), [...reachable.values()], previous)
      previous = hosts
      setState({
        status: hosts.length && nativeStatus === 'unavailable' ? 'searching' : nativeStatus,
        hosts,
        timedOut: false,
      })
    }
    const direct = () => {
      if (!probe.current || probing || controller.signal.aborted) return
      probing = true
      const found = new Map<string, NearbyHost>()
      void Promise.resolve()
        .then(() =>
          probe.current?.(controller.signal, (host) => {
            if (!tracker.accepts(session) || controller.signal.aborted) return
            found.set(host.key, host)
            const held = reachable.get(host.key)
            reachable.set(
              host.key,
              held?.hostId === host.hostId
                ? {
                    ...host,
                    routes: [
                      ...host.routes,
                      ...held.routes.filter((route) => !host.routes.some((current) => current.url === route.url)),
                    ],
                  }
                : host,
            )
            publish()
          }),
        )
        .catch(() => {})
        .finally(() => {
          probing = false
          if (!tracker.accepts(session) || controller.signal.aborted) return
          reachable = found
          if (!native && !reachable.size) nativeStatus = 'unavailable'
          publish()
        })
    }
    const failed = (code?: string) => {
      if (!tracker.accepts(session)) return
      nativeFailed = true
      nativeStatus = /permission|denied|local.?network/i.test(code ?? '') ? 'denied' : 'unavailable'
      publish()
    }
    publish()
    const subscriptions = native
      ? [
          native.addListener('onResult', (result) => {
            if (nativeFailed) return
            const sighting = sightingFromNative(result)
            if (sighting && tracker.observe(session, sighting)) publish()
          }),
          native.addListener('onLost', ({ key }) => {
            if (tracker.lose(session, key)) publish()
          }),
          native.addListener('onError', ({ code }) => failed(code)),
        ]
      : []
    void native?.start(DISCOVERY_SERVICE, MAX_BROWSE_MS).catch((error: { code?: string }) => failed(error?.code))
    direct()
    const refresh = setInterval(direct, 10_000)
    const expiry = setInterval(() => {
      if (tracker.expire()) publish()
    }, 2000)
    const limit = setTimeout(() => {
      if (!tracker.accepts(session)) return
      controller.abort()
      tracker.close()
      void native?.stop().catch(() => {})
      setState({ status: 'idle', hosts: [], timedOut: true })
    }, MAX_BROWSE_MS)
    return () => {
      clearInterval(refresh)
      clearInterval(expiry)
      clearTimeout(limit)
      controller.abort()
      for (const subscription of subscriptions) subscription.remove()
      // Late native and direct results cannot repopulate a closed screen.
      tracker.close()
      void native?.stop().catch(() => {})
    }
  }, [active, attempt])

  return { state, retry }
}
