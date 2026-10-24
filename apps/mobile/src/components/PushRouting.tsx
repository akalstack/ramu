import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useStore } from '../runtime/store'
import { pushTarget } from '../runtime/pushTarget'
/** Refresh the originating computer before opening a push deep link. Foreground SSE supplies the toast. */
export function PushRouting() {
  const store = useStore(),
    router = useRouter()
  const runtime = useRef({ store, router })
  runtime.current = { store, router }
  const handled = useRef(new Map<string, number>())
  const ready = store.ready
  const knownHosts = store.computers.map((computer) => computer.id).join(',')
  useEffect(() => {
    if (!ready) return
    if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return
    let alive = true,
      remove: (() => void) | undefined
    void import('expo-notifications')
      .then(async (module) => {
        module.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        })
        const route = async (response: import('expo-notifications').NotificationResponse) => {
          const { store, router } = runtime.current
          const key = JSON.stringify([response.notification.request.identifier, response.actionIdentifier])
          const now = Date.now()
          const previous = handled.current.get(key)
          if (!alive || (previous !== undefined && now - previous < 2000)) return
          const target = pushTarget(
            response.notification.request.content.data,
            store.computers.map((c) => c.id),
          )
          if (!target) return
          handled.current.set(key, now)
          // Bound session memory without losing deduplication of recent taps.
          if (handled.current.size > 100) handled.current.delete(handled.current.keys().next().value!)
          store.select(target.computerId)
          // Not about one thread: the schedules, or the Inbox on its recaps.
          if (target.kind === 'schedules') return router.navigate('/schedules')
          if (target.kind === 'recaps') return router.navigate({ pathname: '/inbox', params: { tab: 'recaps' } })
          await store.refresh(target.computerId).catch(() => {})
          if (alive)
            router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(target.computerId, target.taskId) } })
        }
        const listener = module.addNotificationResponseReceivedListener((response) => void route(response))
        remove = () => listener.remove()
        const last = await module.getLastNotificationResponseAsync()
        if (last) {
          await route(last)
          await module.clearLastNotificationResponseAsync()
        }
        if (!alive) remove()
      })
      .catch(() => {})
    return () => {
      alive = false
      remove?.()
    }
  }, [ready, knownHosts])
  return null
}
