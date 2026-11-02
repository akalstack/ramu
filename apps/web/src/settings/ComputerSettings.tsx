import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useStagedValue, useStaging } from './stagedChanges'
import { Check } from 'lucide-react'
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { SettingsScopeContext } from './SettingsScope'
import { SETTINGS_FORM_CLASS } from './constants'
import { ownHostId } from '../hosts'
import type { RamuMethods } from '@ramu/shared/api'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/desktop-button'
import { invokeOn, ramu } from '../ipc'
import { useComputers } from '../workspace/computers'
import { t, useLanguage } from '../i18n'
import { KeepAwakeSettings } from './KeepAwakeSettings'
import type { DraftProps } from './ToggleRow'
import { appControlHelp, runtimeHelp } from '@ramu/shared/computerStatus'
import { errorText } from '../lib/errors'

type Status = ReturnType<RamuMethods['computer.status']>

/** Turning this on lets you grant a thread the main display. Nothing is shared until you do, per thread. */
export function ComputerSettings({
  hostId,
  awakeControl,
  readOnly = false,
}: {
  hostId: string
  awakeControl?: ReactNode
  readOnly?: boolean
}) {
  useLanguage()
  const access = useRef({ hostId, readOnly })
  access.current = { hostId, readOnly }
  const canWrite = useCallback(() => access.current.hostId === hostId && !access.current.readOnly, [hostId])
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [setupStarted, setSetupStarted] = useState(false)
  const refresh = useCallback(async () => {
    if (readOnly || access.current.readOnly || access.current.hostId !== hostId) return
    setStatus(await invokeOn(hostId, 'computer.status'))
  }, [hostId, readOnly])
  useEffect(() => {
    let active = true
    setStatus(null)
    void refresh().catch((reason) => active && setError(t(errorText(reason))))
    return () => {
      active = false
    }
  }, [refresh])
  useEffect(() => {
    if (!status?.apps?.available) return
    const check = () => {
      if (document.visibilityState !== 'hidden') void refresh().catch(() => {})
    }
    const timer = setInterval(check, 3000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [status?.apps?.available, refresh])
  const [agentUse, stageAgentUse] = useStagedValue('computer.enabled', !!status?.enabled, async (enabled) => {
    if (!canWrite()) return
    await invokeOn(hostId, 'computer.setEnabled', enabled)
    await refresh()
  })
  const [realPointer, stageRealPointer] = useStagedValue(
    'computer.globalPointer',
    !!status?.globalPointer,
    async (checked) => {
      if (!canWrite()) return
      await invokeOn(hostId, 'computer.setGlobalPointer', checked)
      await refresh()
    },
  )
  const install = async () => {
    if (!canWrite()) return
    setBusy(true)
    setError('')
    try {
      setSetupStarted(false)
      if (status?.apps?.available && status.appPermissions === undefined) {
        await ramu.invoke('background.restart')
        await refresh()
        return
      }
      if (status?.apps?.available && status.appPermissions === null && !status.appUpdate?.updateAvailable) {
        await refresh()
        return
      }
      if (status?.apps?.available && !status.appUpdate?.updateAvailable) await invokeOn(hostId, 'computer.openSetup')
      else await invokeOn(hostId, 'computer.installApps')
      setSetupStarted(true)
      await refresh()
    } catch (reason) {
      setError(t(errorText(reason)))
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  if (readOnly)
    return (
      <p role="status" className="text-caption text-muted-foreground">
        {t(VIEW_ONLY_WRITE_NOTICE)}
      </p>
    )
  return (
    <>
      <SettingsGroupTitle>{t('Agent access')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel title={t('Let agents use this computer')} help={t(runtimeHelp(status))} />
        <Switch
          aria-label={t('Let agents use this computer')}
          checked={agentUse}
          disabled={busy || !status || (!status.enabled && !status.runtime.available)}
          onCheckedChange={stageAgentUse}
        />
      </SettingsRow>
      {status?.apps && (
        <SettingsRow>
          <SettingsLabel title={t('App control')} help={t(appControlHelp(status))} />
          {!(!status.apps.available && status.apps.reason === 'unsupported') && (
            <Button
              size="sm"
              disabled={
                busy ||
                hostId !== ownHostId() ||
                (!!status.appPermissions?.allGranted && !status.appUpdate?.updateAvailable)
              }
              onClick={() => void install()}
            >
              {busy ? (
                t('Setting up…')
              ) : status.appUpdate?.updateAvailable ? (
                t('Update')
              ) : status.apps.available && status.appPermissions === undefined ? (
                t('Restart service')
              ) : status.appPermissions?.allGranted ? (
                <>
                  <Check size={14} />
                  {t('Permissions granted')}
                </>
              ) : status.apps.available && status.appPermissions === null ? (
                t('Retry permission check')
              ) : status.apps.available ? (
                t('Set up permissions')
              ) : (
                t('Install & set up')
              )}
            </Button>
          )}
        </SettingsRow>
      )}
      {setupStarted && !status?.appPermissions?.allGranted && (
        <p role="status" className="text-caption text-muted-foreground">
          {t(
            'Permission setup started on this Mac. Follow Open Computer Use’s prompts to allow Accessibility and Screen Recording, then return here.',
          )}
        </p>
      )}
      {status?.enabled && status.apps?.available && (
        <SettingsRow>
          <SettingsLabel
            title={t('Let app drags use your real pointer')}
            help={t(
              status.globalPointer
                ? 'On. Dragging in an app can move windows and select text, and it may move your pointer while the agent works.'
                : 'Off. Drags stay inside the app and never move your pointer, but cannot move windows or select text.',
            )}
          />
          <Switch
            aria-label={t('Let app drags use your real pointer')}
            checked={realPointer}
            disabled={busy}
            onCheckedChange={stageRealPointer}
          />
        </SettingsRow>
      )}
      {status?.enabled && awakeControl}
      <LockedUseRow
        key={`locked:${revision}`}
        hostId={hostId}
        canWrite={canWrite}
        visible={!!status?.enabled && !!status.apps?.available}
      />
      <ScreenSharing key={`sharing:${revision}`} hostId={hostId} canWrite={canWrite} enabled={!!status?.enabled} />
      <p className="m-[0_0_12px] text-caption text-muted-foreground">
        {t(
          'macOS asks for Screen Recording and Accessibility the first time. Display control pauses when you use the mouse or keyboard where supported. Choose Take control to step in. Turning this off ends every thread’s access.',
        )}
      </p>
      <SettingsRow>
        <SettingsLabel
          title={t('Reset defaults')}
          help={t(
            'Turn off computer access, real-pointer drags, locked-screen use and screen sharing. Active computer sessions end. Installed tools and macOS permissions are kept.',
          )}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !status}
          onClick={async () => {
            if (!canWrite()) return
            setBusy(true)
            setError('')
            try {
              await invokeOn(hostId, 'computer.resetDefaults')
              if (hostId === ownHostId()) {
                const shared = await ramu.invoke('computers.screenSharing')
                for (const id of shared) {
                  if (!canWrite()) return
                  await ramu.invoke('computers.setScreenSharing', id, false)
                }
              }
              await refresh()
              setRevision((value) => value + 1)
            } catch (reason) {
              setError(t(errorText(reason)))
            } finally {
              setBusy(false)
            }
          }}
        >
          {t('Reset defaults')}
        </Button>
      </SettingsRow>
      {error && (
        <p role="alert" className="m-[0_0_12px] text-caption text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

/** Both sides of using another computer's screen: this computer opts in per host, and this host's owner allows devices. */
function ScreenSharing({ hostId, enabled, canWrite }: { hostId: string; enabled: boolean; canWrite: () => boolean }) {
  useLanguage()
  const computers = useComputers()
  const [shared, setShared] = useState<string[]>([])
  const { valueOf, stage } = useStaging()
  const [devices, setDevices] = useState<ReturnType<RamuMethods['computer.runtimeDevices']>>([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!canWrite()) return
    try {
      setShared(await ramu.invoke('computers.screenSharing'))
      if (!canWrite()) return
      setDevices(enabled ? await invokeOn(hostId, 'computer.runtimeDevices') : [])
    } catch (reason) {
      setError(t(errorText(reason)))
    }
  }, [hostId, enabled, canWrite])
  useEffect(() => {
    void load()
  }, [load])
  const act = async (work: () => Promise<unknown>) => {
    if (!canWrite()) return
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
          <Switch
            aria-label={t('Let {0} use this computer’s screen', { 0: computer.name })}
            checked={valueOf(`screen:${computer.id}`, shared.includes(computer.id))}
            onCheckedChange={(checked) =>
              stage(`screen:${computer.id}`, checked, shared.includes(computer.id), (value) =>
                act(() => ramu.invoke('computers.setScreenSharing', computer.id, value)),
              )
            }
          />
        </SettingsRow>
      ))}
      {devices.map((device) => (
        <SettingsRow key={device.deviceId}>
          <SettingsLabel
            title={t('{0} shares its screen with this host', { 0: device.name })}
            help={device.online ? t('Online') : t('Offline')}
          />
          <Switch
            aria-label={t('{0} shares its screen with this host', { 0: device.name })}
            checked={valueOf(`runtime:${device.deviceId}`, device.allowed)}
            onCheckedChange={(checked) =>
              stage(`runtime:${device.deviceId}`, checked, device.allowed, (value) =>
                act(() => invokeOn(hostId, 'computer.allowRuntime', device.deviceId, value)),
              )
            }
          />
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

type LockedUse = ReturnType<RamuMethods['computer.lockedUse']>

/**
 * Working through a locked screen. It installs signed components into macOS sign-in and needs an administrator password
 * at the Mac, so it is a two-step choice that explains that first, and it can be turned off again here.
 */
function LockedUseRow({ hostId, visible, canWrite }: { hostId: string; visible: boolean; canWrite: () => boolean }) {
  useLanguage()
  const [state, setState] = useState<LockedUse | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')
  const read = useCallback(async () => {
    if (!canWrite()) return
    try {
      const next = await invokeOn(hostId, 'computer.lockedUse')
      setState(next)
      if (next.enabled) setWaiting(false)
    } catch (reason) {
      setError(t(errorText(reason)))
    }
  }, [hostId, canWrite])
  useEffect(() => {
    if (visible) void read()
  }, [visible, read])
  // The installer waits for the person at the Mac, so look again until it finishes or they stop waiting.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => void read(), 3000)
    const stop = setTimeout(() => setWaiting(false), 10 * 60_000)
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [waiting, read])
  if (!visible || !state) return null
  const act = async (work: () => Promise<LockedUse>, after?: () => void) => {
    if (!canWrite()) return
    setError('')
    try {
      setState(await work())
      after?.()
    } catch (reason) {
      setError(t(errorText(reason)))
    }
  }
  const help = state.enabled
    ? state.available
      ? t('On. The agent can keep working while this Mac is locked.')
      : t('On, but not ready: {0}', { 0: state.blockers[0] ?? state.stage })
    : waiting
      ? t('Finish the permission and password prompts on this Mac…')
      : t('Off. The agent stops at the lock screen.')
  return (
    <>
      <SettingsRow>
        <SettingsLabel title={t('Keep working while the screen is locked')} help={help} />
        <Switch
          aria-label={t('Keep working while the screen is locked')}
          checked={state.enabled}
          disabled={waiting}
          onCheckedChange={(checked) =>
            checked ? setConfirming(true) : void act(() => invokeOn(hostId, 'computer.lockedUseDisable'))
          }
        />
      </SettingsRow>
      {confirming && !state.enabled && (
        <div
          className="flex flex-col gap-2 rounded border p-3 text-caption"
          role="group"
          aria-label={t('Locked screen setup')}
        >
          <p className="m-0">
            {t(
              'This installs signed Open Computer Use components into macOS sign-in. macOS will ask for your administrator password and for Accessibility, Screen Recording and Input Monitoring on this Mac. Only Ramu’s approved client can use it, and you can turn it off here at any time. Anyone who controls Ramu on this Mac could then act while it is locked.',
            )}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                void act(
                  () => invokeOn(hostId, 'computer.lockedUseEnable'),
                  () => {
                    setConfirming(false)
                    setWaiting(true)
                  },
                )
              }
            >
              {t('Continue on this Mac')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t('Cancel')}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

/** Settings → Computer use: the selected host's computer access, kept apart from the browser settings. */
export function ComputerUseSettings(props: DraftProps) {
  useLanguage()
  const scope = useContext(SettingsScopeContext)
  const hostId = scope?.primaryId ?? ownHostId()
  if (scope?.target === 'all' && scope.targets.length > 1)
    return (
      <p className="m-0 text-caption text-muted-foreground">
        {t('Choose one host to manage computer use. Access belongs to the computer that runs it.')}
      </p>
    )
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <ComputerSettings
        key={`computer:${hostId}`}
        hostId={hostId}
        readOnly={!!scope?.targets.find((target) => target.id === hostId)?.viewOnly}
        awakeControl={<KeepAwakeSettings {...props} />}
      />
    </div>
  )
}
