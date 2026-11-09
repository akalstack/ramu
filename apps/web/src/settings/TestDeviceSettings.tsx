import { useCallback, useContext, useEffect, useState } from 'react'
import { Check, CircleCheck, Copy, Smartphone, TriangleAlert } from 'lucide-react'
import {
  testDeviceSummary,
  type PlatformReadiness,
  type TestDevice,
  type TestDeviceStatus,
} from '@ramu/shared/testDevices'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { t, useLanguage } from '../i18n'
import { ownHostId } from '../hosts'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'
import { floatLiveView } from '../liveView/liveViewStore'
import { useHostSelection } from '../workspace/HostSelection'
import { useComputers } from '../workspace/computers'
import { useWorkspace } from '../workspace/workspace'
import { SettingsScopeContext } from './SettingsScope'
import { SETTINGS_FORM_CLASS } from './constants'

function Status({ ready }: { ready: boolean }) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 text-caption ${ready ? 'text-[var(--ok)]' : 'text-warn'}`}
    >
      {ready ? <CircleCheck size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
      {ready ? t('Ready') : t('Needs setup')}
    </span>
  )
}

/** The terminal form of a fix Ramu can also run, so it can be pasted into a shell of the person's own. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="xs"
      title={command}
      onClick={() =>
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied ? t('Copied') : t('Copy command')}
    </Button>
  )
}

/** One platform's part of the checklist: one line when the host cannot run it, Ready, or each missing item with its fix. */
function Checklist({
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
  if (value.unsupported)
    return (
      <SettingsRow>
        <SettingsLabel title={title} help={t(value.unsupported)} />
      </SettingsRow>
    )
  return (
    <>
      {value.missing.length === 0 && (
        <SettingsRow>
          <SettingsLabel title={title} />
          <Status ready />
        </SettingsRow>
      )}
      {value.missing.map((entry) => (
        <SettingsRow key={entry.item}>
          <SettingsLabel title={`${title} · ${entry.item}`} help={entry.fix} />
          <Status ready={false} />
        </SettingsRow>
      ))}
      {value.install && (
        <SettingsRow>
          <SettingsLabel title={t('Taps and typing')} help={value.note ? t(value.note) : undefined} />
          <span className="flex flex-none items-center gap-1">
            <CopyCommand command={value.install} />
            <Button size="xs" disabled={!canInstall || installing} onClick={onInstall}>
              {installing ? t('Installing…') : t('Install idb')}
            </Button>
          </span>
        </SettingsRow>
      )}
    </>
  )
}

/** A running device: what it is, the thread holding it (opens it), and Watch and Stop. */
function InUse({
  hostId,
  device,
  readOnly,
  onLeave,
  onStop,
}: {
  hostId: string
  device: TestDevice
  readOnly: boolean
  /** Closes Settings to show the thread; absent while Settings has unsaved changes. */
  onLeave?: () => void
  onStop: () => void
}) {
  const ws = useWorkspace()
  const { select } = useHostSelection()
  const computers = useComputers()
  const thread = device.heldBy
  // Only the window's own host has its threads loaded here; another host's thread is named generically.
  const title = thread && hostId === computers?.current ? ws.task(thread)?.title : undefined
  const leave = (then: () => void) => {
    then()
    onLeave?.()
  }
  return (
    <SettingsRow className="gap-3!">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Smartphone size={14} className="flex-none text-muted-foreground" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-control">{device.name}</span>
          {thread &&
            (onLeave ? (
              <Button
                variant="link"
                size="xs"
                className="h-auto justify-start p-0 text-caption text-muted-foreground"
                onClick={() => leave(() => select(hostId, { kind: 'task', taskId: thread }))}
              >
                {title ?? t('Open thread')}
              </Button>
            ) : (
              <span className="truncate text-caption text-muted-foreground">{title ?? t('Held by a thread')}</span>
            ))}
        </span>
      </span>
      <span className="flex flex-none items-center gap-1">
        {thread && onLeave && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => leave(() => floatLiveView(hostId, thread, { kind: 'computer' }))}
          >
            {t('Watch')}
          </Button>
        )}
        <Button variant="ghost" size="xs" disabled={readOnly} onClick={onStop}>
          {t('Stop')}
        </Button>
      </span>
    </SettingsRow>
  )
}

/**
 * Settings → Test devices on one host: the switch and a status line first, then what each platform needs as a
 * checklist, then the devices running now. The page checks again whenever Ramu regains focus, so installing Xcode or
 * the Android SDK elsewhere shows up without a refresh.
 */
function TestDeviceSettings({
  hostId,
  readOnly,
  onLeave,
}: {
  hostId: string
  readOnly: boolean
  onLeave?: () => void
}) {
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
    const again = () => void load()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [load])
  const [installing, setInstalling] = useState(false)
  const installHelper = () => {
    setInstalling(true)
    setError(null)
    invokeOn(hostId, 'testDevices.installHelper')
      .then(load, (cause) => setError(t(errorText(cause))))
      .finally(() => setInstalling(false))
  }
  const summary = status ? testDeviceSummary(status) : null
  const running = status?.devices.filter((device) => device.running) ?? []
  const checklist = (title: string, value: PlatformReadiness) => (
    <Checklist title={title} value={value} installing={installing} canInstall={!readOnly} onInstall={installHelper} />
  )
  return (
    <div className={SETTINGS_FORM_CLASS}>
      {/* Not a host preference: it is turned on with its own call, so the row names no setting path. */}
      <SettingsRow className="settings-toggle">
        <SettingsLabel
          title={t('Let agents use test devices')}
          help={
            summary
              ? summary.parts.map((part) => t(part.text, part.values)).join(' · ')
              : t('Agents boot iOS Simulators and Android emulators on this host and check the app they built.')
          }
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
      {error && (
        <p role="alert" className="m-0 mb-4 text-caption text-bad">
          {error}
        </p>
      )}
      {status && (
        <section aria-label={t('Setup')}>
          <SettingsGroupTitle>{t('Setup')}</SettingsGroupTitle>
          {checklist(t('iOS Simulator'), status.ios)}
          {checklist(t('Android emulator'), status.android)}
        </section>
      )}
      {running.length > 0 && (
        <section aria-label={t('In use')}>
          <SettingsGroupTitle>{t('In use')}</SettingsGroupTitle>
          {running.map((device) => (
            <InUse
              key={device.id}
              hostId={hostId}
              device={device}
              readOnly={readOnly}
              onLeave={onLeave}
              onStop={() =>
                void invokeOn(hostId, 'testDevices.stop', device.id).then(load, (cause) => setError(errorText(cause)))
              }
            />
          ))}
        </section>
      )}
    </div>
  )
}

/** Settings → Test devices for the selected host; devices belong to the computer that runs them. */
export function TestDevicesPage({ onLeave }: { onLeave?: () => void }) {
  useLanguage()
  const scope = useContext(SettingsScopeContext)
  const hostId = scope?.primaryId ?? ownHostId()
  if (scope?.target === 'all' && scope.targets.length > 1)
    return (
      <p className="m-0 text-caption text-muted-foreground">
        {t('Choose one host to manage test devices. Devices belong to the computer that runs them.')}
      </p>
    )
  return (
    <TestDeviceSettings
      key={`devices:${hostId}`}
      hostId={hostId}
      readOnly={!!scope?.targets.find((target) => target.id === hostId)?.viewOnly}
      onLeave={onLeave}
    />
  )
}
