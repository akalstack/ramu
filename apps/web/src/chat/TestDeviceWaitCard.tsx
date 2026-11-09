import { useEffect, useState } from 'react'
import { Hourglass, Smartphone } from 'lucide-react'
import { queuePlace, type TestDevicePlace, type TestPlatform } from '@ramu/shared/testDevices'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../workspace/TaskPane'

/** How often a waiting thread's place is read again; a queue moves when another thread lets a device go. */
const POLL_MS = 3000

/** A thread waiting in line for a test device: its place, Stop waiting, and the device once it comes. */
export function TestDeviceWaitCard({ taskId, platform }: { taskId: string; platform: TestPlatform }) {
  useLanguage()
  const { invoke } = useHost()
  const [place, setPlace] = useState<TestDevicePlace | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () =>
      void invoke('testDevices.place', taskId).then(
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
  }, [invoke, taskId])
  const what = t(platform === 'ios' ? 'iOS Simulator' : 'Android emulator')
  const waiting = place?.state === 'waiting'
  const detail =
    place?.state === 'waiting'
      ? (() => {
          const line = queuePlace(place.position)
          return t(line.text, line.values)
        })()
      : place?.state === 'held'
        ? place.name
        : t('No longer waiting')
  return (
    <div className="m-[12px_0] flex items-center gap-3 rounded-(--radius-m) bg-fill p-[15px]">
      {waiting ? (
        <Hourglass size={16} className="flex-none" aria-hidden="true" />
      ) : (
        <Smartphone size={16} className="flex-none" aria-hidden="true" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <strong>{what}</strong>
        <span className="text-caption text-muted-foreground" role="status">
          {place ? detail : t('Getting a device ready')}
        </span>
        {error && <span className="text-caption text-bad">{error}</span>}
      </div>
      {waiting && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void invoke('testDevices.stop', taskId).then(
              () => setPlace({ state: 'none' }),
              (cause: unknown) => setError(errorText(cause)),
            )
          }
        >
          {t('Stop waiting')}
        </Button>
      )}
    </div>
  )
}
