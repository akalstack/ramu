import { useCallback, useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import type { PlatformReadiness, TestDeviceStatus } from '@ramu/shared/testDevices'
import { SettingsGroupTitle, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { t, useLanguage } from '../i18n'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'

function Readiness({ title, value }: { title: string; value: PlatformReadiness }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 text-caption">
      <p className={`m-0 ${value.ready ? 'text-foreground' : 'text-muted-foreground'}`}>
        {title} · {value.ready ? t('Ready') : t('Not ready')}
      </p>
      {value.missing.map((entry) => (
        <p key={entry.item} className="m-0 text-muted-foreground">
          {entry.item}: {entry.fix}
        </p>
      ))}
      {value.note && <p className="m-0 text-muted-foreground">{value.note}</p>}
    </div>
  )
}

/** Settings › Computer use › Test devices: off by default, with each platform's readiness and what fixes it. */
export function TestDeviceSettings({ hostId, readOnly }: { hostId: string; readOnly: boolean }) {
  useLanguage()
  const [status, setStatus] = useState<TestDeviceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      invokeOn(hostId, 'testDevices.status').then(
        (next) => {
          setStatus(next)
          setError(null)
        },
        (cause) => setError(errorText(cause)),
      ),
    [hostId],
  )
  useEffect(() => {
    void load()
  }, [load])
  const running = status?.devices.filter((device) => device.running) ?? []
  return (
    <section className="flex flex-col" aria-label={t('Test devices')}>
      <SettingsGroupTitle>{t('Test devices')}</SettingsGroupTitle>
      <SettingsRow setting="testDevices" className="settings-toggle">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-control">{t('Let agents use test devices')}</p>
          <p className="m-0 text-caption text-muted-foreground">
            {t(
              'Agents boot iOS Simulators and Android emulators on this host, install the app they built and check it like computer use. Xcode and the Android SDK stay your install.',
            )}
          </p>
        </div>
        <Switch
          checked={!!status?.enabled}
          disabled={readOnly || !status}
          aria-label={t('Let agents use test devices')}
          onCheckedChange={(checked) =>
            void invokeOn(hostId, 'testDevices.setEnabled', checked).then(load, (cause) => setError(errorText(cause)))
          }
        />
      </SettingsRow>
      {status && (
        <>
          <Readiness title="iOS" value={status.ios} />
          <Readiness title="Android" value={status.android} />
        </>
      )}
      {running.map((device) => (
        <div key={device.id} className="flex items-center gap-2 py-1 text-control">
          <Smartphone size={13} className="text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{device.name}</span>
          <Button
            variant="ghost"
            size="xs"
            disabled={readOnly}
            onClick={() => void invokeOn(hostId, 'testDevices.stop', device.id).then(load)}
          >
            {t('Stop')}
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
    </section>
  )
}
