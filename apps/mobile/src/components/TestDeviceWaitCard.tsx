import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Hourglass, Smartphone } from 'lucide-react-native'
import { queuePlace, type TestDevicePlace, type TestPlatform } from '@ramu/shared/testDevices'
import { font, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Button, Card, T } from './ui'

/** How often a waiting thread's place is read again; a queue moves when another thread lets a device go. */
const POLL_MS = 3000

/** A thread waiting in line for a test device: its place, Stop waiting, and the device once it comes. */
export function TestDeviceWaitCard({
  computerId,
  taskId,
  platform,
}: {
  computerId: string
  taskId: string
  platform: TestPlatform
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [place, setPlace] = useState<TestDevicePlace | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () =>
      void store.invoke(computerId, 'testDevices.place', taskId).then(
        (next) => {
          if (!active) return
          setPlace(next)
          if (next.state === 'waiting') timer = setTimeout(read, POLL_MS)
        },
        () => {},
      )
    read()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [store, computerId, taskId])
  const waiting = place?.state === 'waiting'
  const line = place?.state === 'waiting' ? queuePlace(place.position) : null
  const detail = line
    ? say(line.text, line.values)
    : place?.state === 'held'
      ? place.name
      : place
        ? say('No longer waiting')
        : say('Getting a device ready')
  const Icon = waiting || !place ? Hourglass : Smartphone
  return (
    <Card style={{ marginVertical: space.s, padding: space.m, gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Icon size={16} color={c.text} />
        <View style={{ flex: 1 }}>
          <T weight="600">{say(platform === 'ios' ? 'iOS Simulator' : 'Android emulator')}</T>
          <T size={font.caption} tone="muted" accessibilityLiveRegion="polite">
            {detail}
          </T>
        </View>
      </View>
      {error ? (
        <T size={font.caption} tone="bad">
          {error}
        </T>
      ) : null}
      {waiting ? (
        <Button
          kind="secondary"
          title={say('Stop waiting')}
          onPress={() =>
            void store.invoke(computerId, 'testDevices.stop', taskId).then(
              () => setPlace({ state: 'none' }),
              (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
            )
          }
        />
      ) : null}
    </Card>
  )
}
