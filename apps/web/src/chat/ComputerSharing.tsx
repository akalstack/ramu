import { useCallback, useEffect, useState } from 'react'
import type { NetworkDevice } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { ramu } from '../ipc'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { useHost } from '../workspace/HostProvider'

/** The owner decides which paired devices may watch this thread's screen, and whether they may also steer it. */
export function ComputerSharing({ taskId }: { taskId: string }) {
  const { invoke, isLocal } = useHost()
  const [devices, setDevices] = useState<NetworkDevice[]>([])
  const [shared, setShared] = useState<{ deviceId: string; input: boolean }[]>([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const [network, viewers] = await Promise.all([ramu.invoke('network.status'), invoke('computer.viewers', taskId)])
      setDevices(network.devices.filter((device) => device.role !== 'viewer'))
      setShared(viewers)
      setError('')
    } catch (reason) {
      setError(t(errorText(reason)))
    }
  }, [invoke, taskId])
  useEffect(() => {
    void load()
  }, [load])
  if (!isLocal || (!devices.length && !error)) return null
  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
    } catch (reason) {
      setError(t(errorText(reason)))
    }
    await load()
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{t('Paired devices')}</span>
      {devices.map((device) => {
        const entry = shared.find((viewer) => viewer.deviceId === device.id)
        return (
          <div key={device.id} className="flex flex-wrap items-center gap-2 text-caption">
            <span className="min-w-0 flex-1 truncate">
              {device.name}
              {entry ? ` · ${entry.input ? t('Can control') : t('Can watch')}` : ''}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void act(() => invoke('computer.grantViewer', taskId, device.id, false))}
            >
              {t('Watch')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void act(() => invoke('computer.grantViewer', taskId, device.id, true))}
            >
              {t('Control')}
            </Button>
            {entry && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void act(() => invoke('computer.revokeViewer', taskId, device.id))}
              >
                {t('Revoke')}
              </Button>
            )}
          </div>
        )
      })}
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
