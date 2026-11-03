import { useCallback, useEffect, useState } from 'react'
import type { RamuMethods } from '@ramu/shared/api'
import type { Computer } from '@ramu/shared/types'
import { SettingsLabel } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import { ramu } from '../ipc'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { SETTINGS_CARD_LINE } from './cards'

/**
 * On a host's card: whether that host may use this computer's screen for its agents. This computer's own choice, kept on
 * this device; that host's owner also has to allow it there.
 */
export function HostScreenSharing({ computer }: { computer: Computer }) {
  useLanguage()
  const [shared, setShared] = useState<string[] | null>(null)
  const load = useCallback(() => void ramu.invoke('computers.screenSharing').then(setShared, () => setShared([])), [])
  useEffect(load, [load])
  if (!shared) return null
  const on = shared.includes(computer.id)
  const label = t('Let {0} use this computer’s screen', { 0: computer.name })
  return (
    <div className={SETTINGS_CARD_LINE}>
      <SettingsLabel
        title={label}
        help={t('Off by default. That host’s owner must also allow this computer, and can revoke it at any time.')}
      />
      <Switch
        aria-label={label}
        checked={on}
        onCheckedChange={(value) =>
          void ramu
            .invoke('computers.setScreenSharing', computer.id, value)
            .then(load, (reason) => notifyError(errorText(reason), t('Remote access')))
        }
      />
    </div>
  )
}

type RuntimeDevice = ReturnType<RamuMethods['computer.runtimeDevices']>[number]

/** The devices offering this host their screen, by device id, and allowing or refusing one. */
export function useScreenOffers(
  invoke: <M extends 'computer.runtimeDevices' | 'computer.allowRuntime'>(
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ) => Promise<Awaited<ReturnType<RamuMethods[M]>>>,
) {
  const [offers, setOffers] = useState<Map<string, RuntimeDevice>>(new Map())
  const load = useCallback(
    () =>
      void invoke('computer.runtimeDevices').then(
        (devices) => setOffers(new Map(devices.map((device) => [device.deviceId, device]))),
        () => setOffers(new Map()),
      ),
    [invoke],
  )
  useEffect(load, [load])
  const allow = (deviceId: string, value: boolean) =>
    void invoke('computer.allowRuntime', deviceId, value).then(load, (reason) =>
      notifyError(errorText(reason), t('Remote access')),
    )
  return { offers, allow }
}

/** In a paired device's permissions: using the screen it offers this host, for agents here. */
export function DeviceScreenLine({
  name,
  offer,
  onChange,
}: {
  name: string
  offer: RuntimeDevice
  onChange: (allowed: boolean) => void
}) {
  useLanguage()
  const label = t('{0} shares its screen with this host', { 0: name })
  return (
    <div className={SETTINGS_CARD_LINE}>
      <SettingsLabel title={label} help={offer.online ? t('Online') : t('Offline')} />
      <Switch aria-label={label} checked={offer.allowed} onCheckedChange={onChange} />
    </div>
  )
}
