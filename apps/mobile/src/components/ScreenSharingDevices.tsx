import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import type { RamuMethods } from '@ramu/shared/api'
import { space } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Hint, ToggleRow } from './SettingRows'
import { Card, Divider, SectionLabel } from './ui'

type Device = ReturnType<RamuMethods['computer.runtimeDevices']>[number]

/**
 * In Remote access, beside what this phone may do on the host: the paired devices offering that host their screen for
 * its agents, each allowed or not. Only the host's owner decides; a viewer sees nothing here.
 */
export function ScreenSharingDevices({ hostId }: { hostId: string }) {
  const say = useSay()
  const store = useStore()
  const readOnly = store.computers.find((computer) => computer.id === hostId)?.access === 'viewer'
  const online = store.isOnline(hostId)
  const [devices, setDevices] = useState<Device[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    if (!online || readOnly) return setDevices([])
    void store.invoke(hostId, 'computer.runtimeDevices').then(setDevices, () => setDevices([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [hostId, online, readOnly]; the store is current as of that run
  }, [hostId, online, readOnly])
  useEffect(load, [load])
  if (!devices.length) return null
  return (
    <>
      <SectionLabel>{say('Devices sharing their screen')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {devices.map((device, index) => (
          <View key={device.deviceId}>
            {index ? <Divider inset={space.l} /> : null}
            <ToggleRow
              title={say('{0} shares its screen with this host', { 0: device.name })}
              help={say(device.online ? 'Online' : 'Offline')}
              value={device.allowed}
              disabled={busy}
              onChange={(allow) => {
                setBusy(true)
                void store
                  .invoke(hostId, 'computer.allowRuntime', device.deviceId, allow)
                  .catch(() => {})
                  .finally(() => {
                    setBusy(false)
                    load()
                  })
              }}
            />
          </View>
        ))}
      </Card>
      <Hint>{say('Off by default. You can revoke a device at any time.')}</Hint>
    </>
  )
}
