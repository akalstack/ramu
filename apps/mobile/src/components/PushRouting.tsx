import { useEffect } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useStore } from '../runtime/store'
import { pushTarget } from '../runtime/pushTarget'
/** Refresh the originating computer before opening a push deep link. Foreground SSE supplies the toast. */
export function PushRouting() {
  const store = useStore(),
    router = useRouter()
  useEffect(() => {
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
          const target = pushTarget(
            response.notification.request.content.data,
            store.computers.map((c) => c.id),
          )
          if (!alive || !target) return
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
  }, [store.ready, store.computers.map((c) => c.id).join(',')])
  return null
}
