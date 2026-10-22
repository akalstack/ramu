// Nearby-host browsing on the phone through the Ramu-owned `RamuDiscovery` native module (Bonjour on iOS, NSD on
// Android). Expo Go and web have no such module, so discovery reports unavailable and QR or manual entry carry on.
// Browsing runs on this phone, not on a paired host. It starts only while the caller says so and stops on cleanup, so
// leaving the screen, changing method or backgrounding the app ends it. It lists hosts and never pairs.
import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { DISCOVERY_SERVICE, MAX_BROWSE_MS } from '@ramu/shared/discovery/contract'
import { DiscoveryTracker, type NearbyHostsState } from '@ramu/shared/discovery/tracker'
import { sightingFromNative, type NativeSighting } from './nearbyModel'

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

/** Whether this build can browse at all. False in Expo Go and on web. */
export const nearbySupported = () => nativeModule() !== null

const IDLE: NearbyHostsState = { status: 'idle', hosts: [], timedOut: false }

export function useNearbyHosts(active: boolean): { state: NearbyHostsState; retry: () => void } {
  const [state, setState] = useState<NearbyHostsState>(IDLE)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!active) {
      setState(IDLE)
      return
    }
    const native = nativeModule()
    if (!native) {
      setState({ status: 'unavailable', hosts: [], timedOut: false })
      return
    }
    const tracker = new DiscoveryTracker()
    const session = tracker.begin()
    const publish = (status: NearbyHostsState['status'], timedOut = false) =>
      setState({ status, hosts: tracker.accepts(session) ? tracker.hosts() : [], timedOut })
    publish('searching')
    const subscriptions = [
      native.addListener('onResult', (result) => {
        const sighting = sightingFromNative(result)
        if (sighting && tracker.observe(session, sighting)) publish('searching')
      }),
      native.addListener('onLost', ({ key }) => {
        if (tracker.lose(session, key)) publish('searching')
      }),
      native.addListener('onError', ({ code }) => {
        if (!tracker.accepts(session)) return
        const denied = /permission|denied|local.?network/i.test(code ?? '')
        tracker.close()
        setState({ status: denied ? 'denied' : 'unavailable', hosts: [], timedOut: false })
      }),
    ]
    native.start(DISCOVERY_SERVICE, MAX_BROWSE_MS).catch((error: { code?: string }) => {
      if (!tracker.accepts(session)) return
      const denied = /permission|denied|local.?network/i.test(String(error?.code ?? ''))
      tracker.close()
      setState({ status: denied ? 'denied' : 'unavailable', hosts: [], timedOut: false })
    })
    const expiry = setInterval(() => {
      if (tracker.expire()) publish('searching')
    }, 2000)
    const limit = setTimeout(() => {
      if (!tracker.accepts(session)) return
      tracker.close()
      void native.stop().catch(() => {})
      setState({ status: 'idle', hosts: [], timedOut: true })
    }, MAX_BROWSE_MS)
    return () => {
      clearInterval(expiry)
      clearTimeout(limit)
      for (const subscription of subscriptions) subscription.remove()
      // Late callbacks after this point are ignored by the closed tracker.
      tracker.close()
      void native.stop().catch(() => {})
    }
  }, [active, attempt])

  return { state, retry }
}
