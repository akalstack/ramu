import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useStore } from '../runtime/store'
import { Header, Screen } from '../components/Screen'
import { T } from '../components/ui'
import { useSay } from '../i18n'
import { PageLoader } from '../components/PageLoader'
export default function ActivityRoute() {
  const say = useSay()
  const { computerId } = useLocalSearchParams<{ computerId?: string }>()
  const store = useStore(),
    router = useRouter()
  const selected = useRef(false)
  useEffect(() => {
    if (!store.ready) return
    const computer = store.computers.find((c) => c.id === computerId)
    if (!computer) {
      router.replace('/')
      return
    }
    if (!selected.current) {
      selected.current = true
      store.select(computer.id)
    }
    if (computer.status === 'connecting') return
    // The activity names the thread it put first; a thread that came to need the person since then goes ahead of it.
    const named = store.chats.find(
      (c) => c.id === store.drafts['live-activity-target'] && c.computerId === computer.id && c.status !== 'archived',
    )
    const task =
      (named?.status === 'needs-input' ? named : undefined) ??
      store.chats.find((c) => c.computerId === computer.id && c.status === 'needs-input') ??
      named ??
      store.chats.find((c) => c.computerId === computer.id && c.status === 'running')
    if (task) router.replace({ pathname: '/chat/[id]', params: { id: task.id } })
    else router.replace('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [store.ready, computerId, store.computers, store.chats] by design; the values it reads beyond these are current as of that run
  }, [store.ready, computerId, store.computers, store.chats])
  return (
    <Screen scrollable={false}>
      <Header title={say('Ongoing work')} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <PageLoader />
        <T tone="muted">{say('Opening your workspace…')}</T>
      </View>
    </Screen>
  )
}
