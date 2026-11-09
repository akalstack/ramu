import { useCallback, useEffect, useState } from 'react'
import { Check, CircleCheck, Copy, Smartphone, TriangleAlert } from 'lucide-react'
import type { PlatformReadiness, TestDeviceStatus } from '@ramu/shared/testDevices'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { t, useLanguage } from '../i18n'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'

function Readiness({
  title,
  value,
  installing,
  canInstall,
  onInstall,
}: {
  title: string
  value: PlatformReadiness
  installing: boolean
  canInstall: boolean
  onInstall: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = (command: string) =>
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  // A row of the same card as the switch, so a platform's readiness reads as part of the setting.
  return (
    <SettingsRow className="settings-stack gap-1.5!">
      <div className="flex items-center justify-between gap-3">
        <span className="text-control">{title}</span>
        <span
          className={`inline-flex items-center gap-1 text-caption ${value.ready ? 'text-[var(--ok)]' : 'text-warn'}`}
        >
          {value.ready ? <CircleCheck size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
          {value.ready ? t('Ready') : t('Needs setup')}
        </span>
      </div>
      {value.missing.map((entry) => (
        <p key={entry.item} className="m-0 text-caption text-muted-foreground">
          <span className="text-foreground">{entry.item}</span> · {entry.fix}
        </p>
      ))}
      {value.note && <p className="m-0 text-caption text-muted-foreground">{t(value.note)}</p>}
      {value.install && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="xs" disabled={!canInstall || installing} onClick={onInstall}>
            {installing ? t('Installing…') : t('Install idb')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => copy(value.install!)}>
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? t('Copied') : t('Copy command')}
          </Button>
          <code className="min-w-0 flex-1 truncate text-caption text-muted-foreground" title={value.install}>
            {value.install}
          </code>
        </div>
      )}
    </SettingsRow>
  )
}

/** Settings › Computer & devices › Test devices: off by default, with each platform's readiness and what fixes it. */
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
  const [installing, setInstalling] = useState(false)
  const installHelper = () => {
    setInstalling(true)
    setError(null)
    invokeOn(hostId, 'testDevices.installHelper')
      .then(load, (cause) => setError(t(errorText(cause))))
      .finally(() => setInstalling(false))
  }
  const running = status?.devices.filter((device) => device.running) ?? []
  return (
    <section className="flex flex-col" aria-label={t('Test devices')}>
      <SettingsGroupTitle>{t('Test devices')}</SettingsGroupTitle>
      {/* Not a host preference: it is turned on with its own call, so the row names no setting path. */}
      <SettingsRow className="settings-toggle">
        <SettingsLabel
          title={t('Let agents use test devices')}
          help={t(
            'Agents boot iOS Simulators and Android emulators on this host, install the app they built and check it like computer use. You install Xcode and the Android SDK yourself.',
          )}
        />
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
          <Readiness
            title={t('iOS Simulator')}
            value={status.ios}
            installing={installing}
            canInstall={!readOnly}
            onInstall={installHelper}
          />
          <Readiness
            title={t('Android emulator')}
            value={status.android}
            installing={installing}
            canInstall={!readOnly}
            onInstall={installHelper}
          />
        </>
      )}
      {running.map((device) => (
        <SettingsRow key={device.id} className="gap-2!">
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
        </SettingsRow>
      ))}
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
    </section>
  )
}
