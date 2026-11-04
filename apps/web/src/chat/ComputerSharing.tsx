import { useCallback, useEffect, useState } from 'react'
import type { NetworkDevice } from '@ramu/shared/types'
import { grantActive } from '@ramu/shared/devicePermissions'
import { Button } from '@/components/desktop-button'
import { ramu } from '../ipc'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { useHost } from '../workspace/HostProvider'

/**
 * Which of this computer's paired devices can watch and control it from Ramu: those holding the Computer use permission,
 * the same one Remote access manages. A device without it can be allowed here for a day; anything longer is in Remote
 * access. Viewer devices hold no permissions, so they are not listed.
 */
export function ComputerSharing() {
  const { isLocal } = useHost()
  const [devices, setDevices] = useState<NetworkDevice[]>([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const network = await ramu.invoke('network.status')
      setDevices(network.devices.filter((device) => device.role !== 'viewer' && device.kind !== 'host'))
      setError('')
    } catch (reason) {
      setError(t(errorText(reason)))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  if (!isLocal || (!devices.length && !error)) return null
  const allow = async (device: NetworkDevice) => {
    try {
      await ramu.invoke('network.setDevicePermission', device.id, 'computer', 'day')
    } catch (reason) {
      setError(t(errorText(reason)))
    }
    await load()
  }
  const now = Date.now()
  return (
    <div className="flex flex-col gap-1">
      {devices.map((device) => {
        // A device paired before permissions holds every one of them.
        const allowed = !device.permissions || grantActive(device.permissions.computer, now)
        const never = device.blocked?.includes('computer')
        return (
          <div key={device.id} className="flex flex-wrap items-center gap-2 text-caption">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-foreground">{device.name}</span>
              <span className="text-muted-foreground">
                {' · '}
                {allowed
                  ? t('Can watch and control this from Ramu')
                  : never
                    ? t('Computer use is set to Never')
                    : t('Needs Computer use to watch')}
              </span>
            </span>
            {!allowed && !never && (
              <Button size="sm" variant="secondary" onClick={() => void allow(device)}>
                {t('Allow for 1 day')}
              </Button>
            )}
            {!allowed && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'remote' } }))
                }
              >
                {t('Remote access')}
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
