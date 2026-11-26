import { useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { SettingsRow, SettingsTitle } from '@/components/settings-row'
import { errorText } from '../lib/errors'
import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Clock, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import {
  APP_AUTO_UPDATE,
  hoursUntil,
  installsUnattended,
  serviceReportsOlderVersion,
  type AppUpdateStatus,
} from '@ramu/shared/updates'
import { appUpdateView, updateErrorText } from '@ramu/shared/updateView'
import { timeAgo } from '../Menu'
import type { AppPreferences, BackgroundStatus } from '@ramu/shared/types'
import { ramu } from '../ipc'
import { allWorkspaceCheckpoints } from '../workspace/workspaceCheckpoint'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'

export function AppUpdates({ value, onChange }: { value: AppPreferences; onChange: (value: AppPreferences) => void }) {
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  useLanguage()
  const [state, setState] = useState<AppUpdateStatus | null>(null),
    [service, setService] = useState<BackgroundStatus | null>(null)
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    void invoke('updates.status').then(setState, (reason) => setError(errorText(reason)))
    void invoke('background.status').then(setService, () => {})
    const off = on('updates:changed', setState)
    const timer = setInterval(() => {
      void invoke('updates.status').then(setState, () => {})
    }, 2000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [invoke, on])
  const act = async (
    method: 'updates.check' | 'updates.skipWait' | 'updates.download' | 'updates.restart' | 'background.restartService',
  ) => {
    setBusy(true)
    setError(null)
    try {
      if (method === 'background.restartService') {
        await invoke(method, 'keep')
        setService(await invoke('background.status'))
        return
      }
      const result = await invoke(method)
      if (result && 'phase' in result) setState(result)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const working = busy || state?.phase === 'checking' || state?.phase === 'downloading'
  // Installing a release out less than a day asks once more, on the same button.
  const [confirmNow, setConfirmNow] = useState(false)
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
      {state && <UpdateStatusRow state={state} working={working} error={error} onAct={(method) => void act(method)} />}
      {state?.waiting && (
        <SettingsRow>
          <span className="flex min-w-0 items-start gap-2">
            <Clock size={14} className="mt-1 flex-none text-muted-foreground" aria-hidden="true" />
            <span>
              <strong>{t('{0} is waiting', { '0': `Ramu ${state.waiting.version}` })}</strong>
              <span className="muted text-muted-foreground block small text-caption">
                {t('Out less than a day; offered in {0}h. A bad release is usually pulled by then.', {
                  '0': hoursUntil(state.waiting.settlesAt),
                })}
              </span>
              <a className="small text-caption" href={state.waiting.notesUrl} target="_blank" rel="noreferrer">
                {t('Release notes ↗')}
              </a>
            </span>
          </span>
          <Button
            variant={confirmNow ? 'destructive' : 'ghost'}
            disabled={working}
            onBlur={() => setConfirmNow(false)}
            onClick={() => {
              if (!confirmNow) return setConfirmNow(true)
              setConfirmNow(false)
              void act('updates.skipWait')
            }}
          >
            {confirmNow ? t('Install it anyway') : t('Update now')}
          </Button>
        </SettingsRow>
      )}
      <SettingsRow setting="appUpdateChecks" className="settings-toggle">
        <span>
          <SettingsTitle>{t('Check app updates')}</SettingsTitle>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('The background service checks while Ramu is closed.')}
          </span>
        </span>
        <Switch
          aria-label={t('Check app updates')}
          checked={value.appUpdateChecks}
          onCheckedChange={(appUpdateChecks) => onChange({ ...value, appUpdateChecks })}
        />
      </SettingsRow>
      <SettingsRow setting="updateWait" className="settings-toggle">
        <span>
          <SettingsTitle>{t('Wait a day before offering updates')}</SettingsTitle>
          <span className="muted text-muted-foreground block block small text-caption">
            {t(
              'New provider CLI and Ramu releases are offered once they have been out 24 hours, so a bad release is usually pulled before it reaches you. You can still install one now.',
            )}
          </span>
        </span>
        <Switch
          aria-label={t('Wait a day before offering updates')}
          checked={value.updateWait}
          onCheckedChange={(updateWait) => onChange({ ...value, updateWait })}
        />
      </SettingsRow>
      {APP_AUTO_UPDATE && (
        <SettingsRow setting="appAutoUpdate" className="settings-toggle">
          <span>
            <SettingsTitle>{t('Auto-update Ramu')}</SettingsTitle>
            <span className="muted text-muted-foreground block block small text-caption">
              {t(
                'Download updates automatically, then restart on its own once nothing is running and you step away. Threads keep running.',
              )}
            </span>
          </span>
          <Switch
            aria-label={t('Auto-update Ramu')}
            checked={value.appAutoUpdate}
            onCheckedChange={(appAutoUpdate) => onChange({ ...value, appAutoUpdate })}
          />
        </SettingsRow>
      )}
      {(!APP_AUTO_UPDATE || state?.supported === false) && (
        <p className="muted text-muted-foreground small text-caption">
          {t('Automatic install needs a signed macOS app. Other builds install manually.')}
        </p>
      )}
      <SettingsRow className="">
        <span>
          <strong>{t('Service version')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {service?.version ?? '—'} · {service?.build ?? '—'}
          </span>
          <span className="muted text-muted-foreground block block small text-caption">
            {service?.updateAvailable
              ? t(
                  'Service update available. Restart the service to apply it. Agents stop, and unfinished threads resume.',
                )
              : serviceReportsOlderVersion(service)
                ? t(
                    'Runs the same code as the installed app. It shows the older version until the service next restarts.',
                  )
                : t('Matches the installed app. App-only restarts keep threads running.')}
          </span>
        </span>
        {service?.updateAvailable && (
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover"
            disabled={working}
            onClick={() => void act('background.restartService')}
          >
            {t('Restart service')}
          </Button>
        )}
      </SettingsRow>
    </div>
  )
}

type UpdateMethod = 'updates.check' | 'updates.download' | 'updates.restart'

const TONE_ICON = {
  current: <CheckCircle2 size={16} className="text-(--ok)" aria-hidden="true" />,
  busy: (
    <LoaderCircle
      size={16}
      className="text-muted-foreground [animation:spin_0.9s_linear_infinite]"
      aria-hidden="true"
    />
  ),
  offer: <Download size={16} className="text-primary" aria-hidden="true" />,
  ready: <RefreshCw size={16} className="text-primary" aria-hidden="true" />,
  problem: <CircleAlert size={16} className="text-bad" aria-hidden="true" />,
} as const

/**
 * Ramu's update in one row that changes in place: up to date, checking, available, downloading, ready to restart, or
 * what went wrong, each with the one thing to do next. Replaces a version row, a release row and an error line that
 * each said part of it.
 */
function UpdateStatusRow({
  state,
  working,
  error,
  onAct,
}: {
  state: AppUpdateStatus
  working: boolean
  /** A failure of the last button press, shown in place of the state's own detail. */
  error: string | null
  onAct: (method: UpdateMethod) => void
}) {
  const view = appUpdateView(state)
  const problem = error ? 'problem' : view.tone
  const detail = error
    ? t(updateErrorText(error))
    : t(view.detail, { ...view.values, 1: view.checkedAt ? timeAgo(view.checkedAt) : (view.values[1] ?? '') })
  const primary = view.action === 'download' || view.action === 'restart'
  const action = error ? 'retry' : view.action
  return (
    <SettingsRow className="" aria-live="polite">
      <span className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex-none">{TONE_ICON[problem]}</span>
        <span className="min-w-0">
          <strong className="block">{t(view.title, view.values)}</strong>
          <span
            className={`block text-caption ${problem === 'problem' ? 'text-bad' : 'text-muted-foreground'}`}
            role={problem === 'problem' ? 'alert' : undefined}
          >
            {detail}
          </span>
          {state.release && (
            <a className="text-caption" href={state.release.notesUrl} target="_blank" rel="noreferrer">
              {t('Release notes ↗')}
            </a>
          )}
        </span>
      </span>
      {action === 'installer' && state.release ? (
        <a href={state.release.assetUrl} target="_blank" rel="noreferrer">
          {t('Download installer ↗')}
        </a>
      ) : action ? (
        <Button
          variant={primary && !error ? 'default' : 'secondary'}
          className={primary && !error ? undefined : 'bg-fill hover:bg-fill-hover'}
          disabled={working}
          onClick={() =>
            onAct(
              action === 'restart'
                ? 'updates.restart'
                : action === 'download' || (action === 'retry' && state.release)
                  ? 'updates.download'
                  : 'updates.check',
            )
          }
        >
          {action === 'download' ? <Download size={14} /> : <RefreshCw size={14} />}
          {action === 'restart'
            ? t('Restart to update')
            : action === 'download'
              ? t('Download update')
              : action === 'retry'
                ? t('Try again')
                : t('Check for updates')}
        </Button>
      ) : null}
    </SettingsRow>
  )
}

/** How long this window goes untouched before it offers the desktop to install a ready update on its own. */
const UNATTENDED_AFTER_MS = 5 * 60_000
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const

/**
 * Installs a downloaded update once nobody is using Ramu. This window answers for what only it holds: every
 * checkpoint saves its part (drafts, the workspace) and refuses while something cannot be kept, such as an unsaved
 * file, an open terminal or an attachment still uploading. The desktop then checks Auto-update, that the computer
 * itself is idle, and that no thread, terminal or command is running; anything busy waits for the next minute.
 */
function useInstallWhenIdle(state: AppUpdateStatus | null) {
  const ready = !!state && installsUnattended(state)
  useEffect(() => {
    if (!ready) return
    let lastInput = Date.now()
    const touched = () => {
      lastInput = Date.now()
    }
    for (const name of INPUT_EVENTS) window.addEventListener(name, touched, { capture: true, passive: true })
    const timer = window.setInterval(() => {
      if (Date.now() - lastInput < UNATTENDED_AFTER_MS) return
      void (async () => {
        const kept = await Promise.all(allWorkspaceCheckpoints().map((checkpoint) => checkpoint().catch(() => false)))
        if (kept.every(Boolean)) await ramu.invoke('updates.restart', 'idle')
      })().catch(() => {})
    }, 60_000)
    return () => {
      window.clearInterval(timer)
      for (const name of INPUT_EVENTS) window.removeEventListener(name, touched, { capture: true })
    }
  }, [ready])
}

/** One status-bar button for a newer release: Update downloads it, Restart applies it; threads keep running. */
export function AppUpdateButton() {
  useLanguage()
  const [state, setState] = useState<AppUpdateStatus | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    void ramu.invoke('updates.status').then(setState, () => {})
    return ramu.on('updates:changed', setState)
  }, [])
  useInstallWhenIdle(state)
  const release = state?.release
  if (!release) return null
  const run = async (method: 'updates.download' | 'updates.restart') => {
    setBusy(true)
    try {
      const result = await ramu.invoke(method)
      if (result && 'phase' in result) setState(result)
    } catch (reason) {
      notifyError(errorText(reason), 'Ramu')
    } finally {
      setBusy(false)
    }
  }
  const className = 'app-update-button h-[22px] min-h-[22px] gap-[5px] p-[0_6px] text-caption text-soft'
  if (!APP_AUTO_UPDATE || state.supported === false)
    return (
      <Button
        variant="ghost"
        size="sm"
        className={className}
        nativeButton={false}
        render={
          <a href={release.notesUrl} target="_blank" rel="noreferrer" title={t('Ramu {0}', { '0': release.version })} />
        }
      >
        <Download size={13} />
        {t('Update')}
      </Button>
    )
  if (state.phase === 'ready')
    return (
      <Button
        variant="ghost"
        size="sm"
        className={className}
        disabled={!state.nativeReady || busy}
        title={t(
          'Ramu {0} is ready. It installs on its own once nothing is running and you step away, or restart now. Threads keep running.',
          { '0': release.version },
        )}
        onClick={() => void run('updates.restart')}
      >
        <RefreshCw size={13} />
        {state.nativeReady ? t('Restart to update') : t('Preparing update…')}
      </Button>
    )
  const downloading = busy || state.phase === 'downloading'
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      disabled={downloading}
      title={t('Ramu {0}', { '0': release.version })}
      onClick={() => void run('updates.download')}
    >
      <Download size={13} />
      {downloading ? t('Downloading…') : t('Update')}
    </Button>
  )
}
