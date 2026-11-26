import { Dialog as ConfirmDialog } from '../Menu'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useStagedValue } from './stagedChanges'
import { Check } from 'lucide-react'
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { SettingsScopeContext, useRemembered } from './SettingsScope'
import { SETTINGS_FORM_CLASS } from './constants'
import { ownHostId } from '../hosts'
import type { RamuMethods } from '@ramu/shared/api'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/desktop-button'
import { invokeOn } from '../ipc'
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
  const [status, setStatus] = useRemembered<Status | null>(`computer.status:${hostId}`, null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [setupStarted, setSetupStarted] = useState(false)
  const refresh = useCallback(async () => {
    if (readOnly || access.current.readOnly || access.current.hostId !== hostId) return
    setStatus(await invokeOn(hostId, 'computer.status'))
  }, [hostId, readOnly, setStatus])
  useEffect(() => {
    let active = true
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
  // A host that cannot run computer use at all (Linux, Windows) says so once instead of in every row and note.
  const unsupported =
    !!status && !status.enabled && !status.runtime.available && status.runtime.reason === 'unsupported'
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
      {status?.apps && !unsupported && (
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
      {!unsupported && (
        <p className="m-[0_0_12px] text-caption text-muted-foreground">
          {t(
            'macOS asks for Screen Recording and Accessibility the first time. Where supported, display control pauses when you use the mouse or keyboard. Choose Take control to step in. Turning this off ends every thread’s access.',
          )}
        </p>
      )}
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

type LockedUse = ReturnType<RamuMethods['computer.lockedUse']>

/**
 * Working through a locked screen. It installs signed components into macOS sign-in and needs an administrator password
 * at the Mac, so it is a two-step choice that explains that first, and it can be turned off again here.
 */
function LockedUseRow({ hostId, visible, canWrite }: { hostId: string; visible: boolean; canWrite: () => boolean }) {
  useLanguage()
  const [state, setState] = useRemembered<LockedUse | null>(`computer.lockedUse:${hostId}`, null)
  const [confirming, setConfirming] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')
  const read = useCallback(async () => {
    if (!canWrite()) return
    try {
      const next = await invokeOn(hostId, 'computer.lockedUse')
      setState(next)
      // Keep following while the installer is open, even after leaving and coming back; stop once it has ended.
      setWaiting(!next.enabled && !!next.installer?.running)
    } catch (reason) {
      setError(t(errorText(reason)))
    }
  }, [canWrite, hostId, setState])
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
  if (!visible) return null
  if (!state)
    return error ? (
      <p role="alert" className="m-[0_0_12px] text-caption text-destructive">
        {error}
      </p>
    ) : null
  // It installs into that Mac's sign-in and asks for its administrator password, so only that Mac can change it.
  const here = hostId === ownHostId()
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
  const installer = state.installer
  // The installer ended without turning it on: what it said, or what macOS still needs.
  const stopped = !state.enabled && installer && !installer.running
  const help = state.enabled
    ? state.available
      ? t('On. The agent can keep working while this Mac is locked.')
      : t('On, but not ready: {0}', { 0: state.blockers[0] ?? state.stage })
    : installer?.running || waiting
      ? t('Enter the administrator password in the prompt on this Mac. It can open behind other windows.')
      : stopped && installer.error
        ? t('Setup stopped: {0}', { 0: installer.error })
        : stopped
          ? t('Almost done: {0}', { 0: state.blockers[0] ?? state.stage })
          : t('Off. The agent stops at the lock screen.')
  const where = here ? '' : ` ${t('Change it in Ramu on that Mac. It asks for that Mac’s administrator password.')}`
  return (
    <>
      <SettingsRow>
        <SettingsLabel title={t('Keep working while the screen is locked')} help={help + where} />
        <Switch
          aria-label={t('Keep working while the screen is locked')}
          checked={state.enabled}
          disabled={waiting || !!installer?.running || !here}
          onCheckedChange={(checked) =>
            checked ? setConfirming(true) : void act(() => invokeOn(hostId, 'computer.lockedUseDisable'))
          }
        />
      </SettingsRow>
      {confirming && !state.enabled && (
        <ConfirmDialog
          title={t('Keep working while the screen is locked?')}
          confirmLabel={t('Continue on this Mac')}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            void act(
              () => invokeOn(hostId, 'computer.lockedUseEnable'),
              () => {
                setConfirming(false)
                setWaiting(true)
              },
            )
          }
        >
          <p>
            {t(
              'This installs signed Open Computer Use components into macOS sign-in. macOS will ask for your administrator password and for Accessibility, Screen Recording and Input Monitoring. Only Ramu’s approved client can use it, and you can turn it off here anytime. Anyone who controls Ramu on this Mac can then act while it is locked.',
            )}
          </p>
        </ConfirmDialog>
      )}
      {stopped && !installer.error && here && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() =>
            void invokeOn(hostId, 'computer.openSetup').then(read, (reason) => setError(t(errorText(reason))))
          }
        >
          {t('Open permission setup')}
        </Button>
      )}
      {error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

/** Settings → Computer: the selected host's computer access, kept apart from the browser settings. */
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
