import { useCallback, useEffect, useState } from 'react'
import type { RamuMethods } from '@ramu/shared/api'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { invokeOn, ramu } from '../ipc'
import { useComputers } from '../workspace/computers'
import { t, useLanguage } from '../i18n'
import { runtimeHelp } from './computerStatus'
import { errorText } from '../lib/errors'

type Status = ReturnType<RamuMethods['computer.status']>

/** Turning this on lets you grant a thread the main display. Nothing is shared until you do, per thread. */
export function ComputerSettings({ hostId }: { hostId: string }) {
  useLanguage()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    setStatus(await invokeOn(hostId, 'computer.status'))
  }, [hostId])
  useEffect(() => {
    let active = true
    setStatus(null)
    void refresh().catch((reason) => active && setError(t(errorText(reason))))
    return () => {
      active = false
    }
  }, [refresh])
  const toggle = async () => {
    if (!status) return
    setBusy(true)
    setError('')
    try {
      await invokeOn(hostId, 'computer.setEnabled', !status.enabled)
      await refresh()
    } catch (reason) {
      setError(t(errorText(reason)))
    } finally {
      setBusy(false)
    }
  }
  const install = async () => {
    setBusy(true)
    setError('')
    try {
      await invokeOn(hostId, 'computer.installApps')
      await refresh()
    } catch (reason) {
      setError(t(errorText(reason)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SettingsGroupTitle>{t('Computer use')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel title={t('Let agents use this computer')} help={t(runtimeHelp(status))} />
        <Button
          variant={status?.enabled ? 'secondary' : 'default'}
          size="sm"
          disabled={busy || !status || (!status.enabled && !status.runtime.available)}
          onClick={() => void toggle()}
        >
          {status?.enabled ? t('Turn off') : t('Turn on')}
        </Button>
      </SettingsRow>
      {status?.enabled && status.apps && (
        <SettingsRow>
          <SettingsLabel
            title={t('Limit access to one app')}
            help={t(
              status.apps.available
                ? 'Ready. Choose an app in a thread; it works in the background without moving your cursor.'
                : (status.apps.detail ?? 'App control is not available on this host.'),
            )}
          />
          {!status.apps.available && status.apps.reason === 'not-installed' && (
            <Button size="sm" disabled={busy} onClick={() => void install()}>
              {busy ? t('Installing…') : t('Install')}
            </Button>
          )}
        </SettingsRow>
      )}
      <ScreenSharing hostId={hostId} enabled={!!status?.enabled} />
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'macOS asks for Screen Recording and Accessibility the first time. Turning this off ends every thread’s access.',
        )}
      </p>
      {error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

/** Both sides of using another computer's screen: this computer opts in per host, and this host's owner allows devices. */
function ScreenSharing({ hostId, enabled }: { hostId: string; enabled: boolean }) {
  useLanguage()
  const computers = useComputers()
  const [shared, setShared] = useState<string[]>([])
  const [devices, setDevices] = useState<ReturnType<RamuMethods['computer.runtimeDevices']>>([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      setShared(await ramu.invoke('computers.screenSharing'))
      setDevices(enabled ? await invokeOn(hostId, 'computer.runtimeDevices') : [])
    } catch (reason) {
      setError(t(errorText(reason)))
    }
  }, [hostId, enabled])
  useEffect(() => {
    void load()
  }, [load])
  const act = async (work: () => Promise<unknown>) => {
    setError('')
    try {
      await work()
    } catch (reason) {
      setError(t(errorText(reason)))
    }
    await load()
  }
  const paired = (computers?.computers ?? []).filter(
    (computer) => computer.id !== computers?.current && computer.id !== 'local',
  )
  return (
    <>
      {paired.map((computer) => (
        <SettingsRow key={computer.id}>
          <SettingsLabel
            title={t('Let {0} use this computer’s screen', { 0: computer.name })}
            help={t('Off by default. That host’s owner must also allow this computer, and can revoke it at any time.')}
          />
          <Button
            size="sm"
            variant={shared.includes(computer.id) ? 'secondary' : 'default'}
            onClick={() =>
              void act(() => ramu.invoke('computers.setScreenSharing', computer.id, !shared.includes(computer.id)))
            }
          >
            {shared.includes(computer.id) ? t('Turn off') : t('Turn on')}
          </Button>
        </SettingsRow>
      ))}
      {devices.map((device) => (
        <SettingsRow key={device.deviceId}>
          <SettingsLabel
            title={t('{0} shares its screen with this host', { 0: device.name })}
            help={device.online ? t('Online') : t('Offline')}
          />
          <Button
            size="sm"
            variant={device.allowed ? 'secondary' : 'default'}
            onClick={() => void act(() => invokeOn(hostId, 'computer.allowRuntime', device.deviceId, !device.allowed))}
          >
            {device.allowed ? t('Block') : t('Allow')}
          </Button>
        </SettingsRow>
      ))}
      {error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      )}
    </>
  )
}
