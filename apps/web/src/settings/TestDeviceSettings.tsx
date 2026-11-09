import { useCallback, useContext, useEffect, useState } from 'react'
import { Check, ChevronDown, CircleCheck, Copy, Hourglass, Smartphone, TriangleAlert } from 'lucide-react'
import {
  queuePlace,
  testDeviceSummary,
  type PlatformReadiness,
  type TestDeviceLease,
  type TestDeviceStatus,
  type TestDeviceWaiting,
  type TestPlatform,
} from '@ramu/shared/testDevices'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from '../Menu'
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

const PLATFORM_TITLE: Record<TestPlatform, string> = { ios: 'iOS Simulator', android: 'Android emulator' }

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
function Checklist({ platform, value }: { platform: TestPlatform; value: PlatformReadiness }) {
  const title = t(PLATFORM_TITLE[platform])
  if (value.unsupported)
    return (
      <SettingsRow>
        <SettingsLabel title={title} help={t(value.unsupported)} />
      </SettingsRow>
    )
  if (!value.missing.length)
    return (
      <SettingsRow>
        <SettingsLabel title={title} />
        <Status ready />
      </SettingsRow>
    )
  return (
    <>
      {value.missing.map((entry) => (
        <SettingsRow key={entry.item}>
          <SettingsLabel title={`${title} · ${entry.item}`} help={entry.fix} />
          <Status ready={false} />
        </SettingsRow>
      ))}
    </>
  )
}

/** A thread with a device, or waiting for one: what it is, the thread (opens it), and Watch and Stop. */
function InUse({
  hostId,
  taskId,
  title,
  detail,
  waiting,
  readOnly,
  onLeave,
  onStop,
}: {
  hostId: string
  taskId: string
  title: string
  detail: string
  waiting: boolean
  readOnly: boolean
  /** Closes Settings to show the thread; absent while Settings has unsaved changes. */
  onLeave?: () => void
  onStop: () => void
}) {
  const ws = useWorkspace()
  const { select } = useHostSelection()
  const computers = useComputers()
  // Only the window's own host has its threads loaded here; another host's thread is named generically.
  const thread = hostId === computers?.current ? ws.task(taskId)?.title : undefined
  const leave = (then: () => void) => {
    then()
    onLeave?.()
  }
  return (
    <SettingsRow className="gap-3!">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {waiting ? (
          <Hourglass size={14} className="flex-none text-muted-foreground" aria-hidden="true" />
        ) : (
          <Smartphone size={14} className="flex-none text-muted-foreground" aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-control">{title}</span>
          <span className="truncate text-caption text-muted-foreground">
            {onLeave ? (
              <Button
                variant="link"
                size="xs"
                className="h-auto p-0 text-caption text-muted-foreground"
                onClick={() => leave(() => select(hostId, { kind: 'task', taskId }))}
              >
                {thread ?? t('Open thread')}
              </Button>
            ) : (
              (thread ?? t('Held by a thread'))
            )}
            {` · ${detail}`}
          </span>
        </span>
      </span>
      <span className="flex flex-none items-center gap-1">
        {!waiting && onLeave && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => leave(() => floatLiveView(hostId, taskId, { kind: 'computer' }))}
          >
            {t('Watch')}
          </Button>
        )}
        <Button variant="ghost" size="xs" disabled={readOnly} onClick={onStop}>
          {waiting ? t('Stop waiting') : t('Stop')}
        </Button>
      </span>
    </SettingsRow>
  )
}

const minutes = (since: number) => Math.max(1, Math.round((Date.now() - since) / 60_000))

/**
 * Settings → Test devices on one host: the switch and a status line first, setup as a checklist, the threads holding
 * or waiting for a device, the model a thread gets by default, and Advanced folded. The page checks again whenever
 * Ramu regains focus, so installing Xcode or the Android SDK elsewhere shows up without a refresh.
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
  const [settingUp, setSettingUp] = useState(false)
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
    // Threads take and give back devices while the page is open.
    const timer = window.setInterval(again, 10_000)
    return () => {
      window.removeEventListener('focus', again)
      window.clearInterval(timer)
    }
  }, [load])
  const call = (work: Promise<unknown>) => void work.then(load, (cause) => setError(t(errorText(cause))))
  const setUp = () => {
    setSettingUp(true)
    setError(null)
    invokeOn(hostId, 'testDevices.setUp')
      .then(load, (cause) => setError(t(errorText(cause))))
      .finally(() => setSettingUp(false))
  }
  const summary = status ? testDeviceSummary(status) : null
  const stop = (taskId: string) => call(invokeOn(hostId, 'testDevices.stop', taskId))
  const lease = (entry: TestDeviceLease) => (
    <InUse
      key={entry.taskId}
      hostId={hostId}
      taskId={entry.taskId}
      title={entry.name}
      detail={t('{0} min', { 0: minutes(entry.since) })}
      waiting={false}
      readOnly={readOnly}
      onLeave={onLeave}
      onStop={() => stop(entry.taskId)}
    />
  )
  const waiting = (entry: TestDeviceWaiting) => {
    const place = queuePlace(entry.position)
    return (
      <InUse
        key={entry.taskId}
        hostId={hostId}
        taskId={entry.taskId}
        title={t(PLATFORM_TITLE[entry.platform])}
        detail={t(place.text, place.values)}
        waiting
        readOnly={readOnly}
        onLeave={onLeave}
        onStop={() => stop(entry.taskId)}
      />
    )
  }
  const platforms = (['ios', 'android'] as const).filter(
    (platform) => status?.[platform].ready && status.models[platform].length,
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
              : t('Each thread gets a fresh iOS Simulator or Android emulator of its own to check the app it built.')
          }
        />
        <Switch
          checked={!!status?.enabled}
          disabled={readOnly || !status}
          aria-label={t('Let agents use test devices')}
          onCheckedChange={(checked) => call(invokeOn(hostId, 'testDevices.setEnabled', checked))}
        />
      </SettingsRow>
      {status && !status.installed && (
        <SettingsRow>
          <SettingsLabel
            title={t('Set up test devices')}
            help={t('Installs Simlock and agent-device in Ramu’s tools folder. No Homebrew, nothing system-wide.')}
          />
          <span className="flex flex-none items-center gap-1">
            <CopyCommand command={status.setupCommand} />
            <Button size="xs" disabled={readOnly || settingUp} onClick={setUp}>
              {settingUp ? t('Setting up…') : t('Set up')}
            </Button>
          </span>
        </SettingsRow>
      )}
      {error && (
        <p role="alert" className="m-0 mb-4 text-caption text-bad">
          {error}
        </p>
      )}
      {status?.installed && (
        <section aria-label={t('Setup')}>
          <SettingsGroupTitle>{t('Setup')}</SettingsGroupTitle>
          <Checklist platform="ios" value={status.ios} />
          <Checklist platform="android" value={status.android} />
        </section>
      )}
      {status && (status.inUse.length > 0 || status.waiting.length > 0) && (
        <section aria-label={t('In use')}>
          <SettingsGroupTitle>{t('In use')}</SettingsGroupTitle>
          {status.inUse.map(lease)}
          {status.waiting.map(waiting)}
        </section>
      )}
      {status && platforms.length > 0 && (
        <section aria-label={t('Defaults')}>
          <SettingsGroupTitle>{t('Defaults')}</SettingsGroupTitle>
          {platforms.map((platform) => (
            <SettingsRow key={platform}>
              <SettingsLabel
                title={t(platform === 'ios' ? 'iPhone or iPad' : 'Android device')}
                help={t('What a thread gets when it names no model.')}
              />
              <Dropdown
                label={t(PLATFORM_TITLE[platform])}
                value={status.defaults[platform] ?? ''}
                disabled={readOnly}
                options={[...status.models[platform]]
                  .sort((a, b) => Number(b.kind === 'phone') - Number(a.kind === 'phone'))
                  .map((model) => ({ value: model.name, label: model.name }))}
                onChange={(model) => call(invokeOn(hostId, 'testDevices.setDefault', platform, model))}
              />
            </SettingsRow>
          ))}
        </section>
      )}
      {status?.installed && (
        <Collapsible className="mt-3">
          <CollapsibleTrigger
            render={<Button variant="ghost" size="sm" className="group/options text-caption text-muted-foreground" />}
          >
            {t('Advanced')}
            <ChevronDown size={14} className="transition-transform group-data-[panel-open]/options:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <SettingsRow className="settings-toggle">
              <SettingsLabel
                title={t('Keep a spare device ready')}
                help={t(
                  'The next thread gets its device in about half the time, but a spare simulator or emulator stays booted and holds memory.',
                )}
              />
              <Switch
                checked={status.keepWarm}
                disabled={readOnly}
                aria-label={t('Keep a spare device ready')}
                onCheckedChange={(checked) => call(invokeOn(hostId, 'testDevices.setKeepWarm', checked))}
              />
            </SettingsRow>
          </CollapsibleContent>
        </Collapsible>
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
