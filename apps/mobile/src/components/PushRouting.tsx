import { useEffect } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useStore } from '../runtime/store'
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
          const data = response.notification.request.content.data
          if (
            !alive ||
            !data ||
            typeof data.computerId !== 'string' ||
            typeof data.taskId !== 'string' ||
            !store.computers.some((c) => c.id === data.computerId)
          )
            return
          store.select(data.computerId)
          await store.refresh(data.computerId).catch(() => {})
          if (alive)
            router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(data.computerId, data.taskId) } })
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
