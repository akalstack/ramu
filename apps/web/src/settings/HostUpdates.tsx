import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { Computer, HostUpdateResult } from '@ramu/shared/types'
import { hostNeedsUpdate, hostUpdateSummary, type HostUpdateSummary } from '@ramu/shared/updates'
import { providerName } from '@ramu/shared/providers/providers'
import { Button } from '@/components/desktop-button'
import { Dialog as ConfirmDialog } from '../Menu'
import { invokeUncachedOn, ramu } from '../ipc'
import { notifyError } from '../chat/Notifications'
import { notify } from '@/components/app-toaster'
import { TOAST_MS } from '../chat/notificationCenter'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'

/** A host's update state, read from that host: its own Ramu release check and its provider CLIs. */
async function readSummary(id: string): Promise<HostUpdateSummary> {
  const [app, providers] = await Promise.all([
    invokeUncachedOn(id, 'updates.status').catch(() => null),
    invokeUncachedOn(id, 'providers.updates').catch(() => []),
  ])
  return hostUpdateSummary(app, providers)
}

/** Updates a host's out-of-date provider CLIs one at a time; returns the ones that failed, with why. */
async function updateProviders(id: string, summary: HostUpdateSummary): Promise<string[]> {
  const failed: string[] = []
  for (const entry of summary.providers)
    await invokeUncachedOn(id, 'providers.update', entry.provider).catch((reason) =>
      failed.push(`${providerName(entry.provider)}: ${errorText(reason)}`),
    )
  return failed
}

/** What updating Ramu on a host did, said once; an install the person does themselves gets the release page. */
function reportRamu(host: string, result: HostUpdateResult) {
  if (result.outcome === 'unavailable') notifyError(`${host}: ${result.message}`, 'Ramu')
  else notify.add({ type: 'success', title: host, description: result.message, timeout: TOAST_MS.success })
  if (result.notesUrl) void ramu.invoke('app.openExternal', result.notesUrl).catch(() => {})
}

const confirmText = (computer: Computer, version: string) =>
  [
    t('Ramu {0} installs on {1}, which restarts and reconnects.', { 0: version, 1: computer.name }),
    computer.running
      ? t(
          '{0} threads are working there. Threads continue after the restart when Continue threads after restart is on.',
          { 0: computer.running },
        )
      : '',
  ]
    .filter(Boolean)
    .join(' ')

/**
 * One host's line in Remote access: its Ramu version and provider CLIs, with Update for each when something is newer.
 * Works the same for this computer and any connected host; the host itself decides how it can install Ramu.
 */
export function HostUpdateLine({ computer, onChanged }: { computer: Computer; onChanged?: () => void }) {
  useLanguage()
  const [summary, setSummary] = useState<HostUpdateSummary | null>(null)
  const [busy, setBusy] = useState<'ramu' | 'providers' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const reachable = computer.local || computer.status === 'connected'
  const load = useCallback(() => {
    if (reachable) void readSummary(computer.id).then(setSummary)
  }, [computer.id, reachable])
  useEffect(load, [load])
  if (!reachable || !summary) return null
  const providers = summary.providers.map((entry) => providerName(entry.provider)).join(', ')
  const parts = [
    summary.currentVersion ? t('Ramu {0}', { 0: summary.currentVersion }) : null,
    summary.nextVersion ? t('{0} available', { 0: summary.nextVersion }) : null,
    summary.providers.length ? t('Updates for {0}', { 0: providers }) : null,
  ].filter(Boolean)
  const run = async (part: 'ramu' | 'providers') => {
    setBusy(part)
    try {
      if (part === 'providers') {
        const failed = await updateProviders(computer.id, summary)
        if (failed.length) notifyError(failed.join('\n'), computer.name)
      } else reportRamu(computer.name, await invokeUncachedOn(computer.id, 'updates.apply'))
    } catch (reason) {
      notifyError(errorText(reason), computer.name)
    } finally {
      setBusy(null)
      load()
      onChanged?.()
    }
  }
  return (
    <div className="mt-1 ml-[44px] flex min-w-0 flex-wrap items-center gap-2 text-caption text-muted-foreground">
      <span className="min-w-0 truncate">{parts.join(' · ') || t('Up to date')}</span>
      {summary.nextVersion && (
        <Button variant="secondary" size="xs" disabled={!!busy} onClick={() => setConfirming(true)}>
          <Download size={12} />
          {busy === 'ramu' ? t('Updating…') : t('Update Ramu')}
        </Button>
      )}
      {summary.providers.length > 0 && (
        <Button variant="secondary" size="xs" disabled={!!busy} onClick={() => void run('providers')}>
          {busy === 'providers' ? t('Updating…') : t('Update providers')}
        </Button>
      )}
      {confirming && summary.nextVersion && (
        <ConfirmDialog
          title={t('Update {0}?', { 0: computer.name })}
          confirmLabel={t('Update Ramu')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void run('ramu')
          }}
        >
          <p className="m-0 text-caption text-muted-foreground">{confirmText(computer, summary.nextVersion)}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

/**
 * Update everything at once: each connected host's provider CLIs, then its Ramu. Hosts are updated one after another so
 * one confirmation covers them all and each result is reported by name.
 */
export function UpdateAllHosts({ computers }: { computers: Computer[] }) {
  useLanguage()
  const [pending, setPending] = useState<{ computer: Computer; summary: HostUpdateSummary }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const reachable = computers.filter((computer) => computer.local || computer.status === 'connected')
  const key = reachable.map((computer) => computer.id).join(',')
  useEffect(() => {
    let live = true
    void Promise.all(reachable.map(async (computer) => ({ computer, summary: await readSummary(computer.id) }))).then(
      (rows) => live && setPending(rows.filter((row) => hostNeedsUpdate(row.summary))),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the connected hosts
  }, [key])
  const [confirming, setConfirming] = useState(false)
  if (!pending || pending.length < 2) return null
  const running = pending.reduce((sum, row) => sum + (row.summary.nextVersion ? row.computer.running : 0), 0)
  const run = async () => {
    setBusy(true)
    for (const { computer, summary } of pending) {
      try {
        const failed = await updateProviders(computer.id, summary)
        if (failed.length) notifyError(failed.join('\n'), computer.name)
        // This computer goes last: installing Ramu here restarts the app that is doing the updating.
        if (summary.nextVersion && !computer.local)
          reportRamu(computer.name, await invokeUncachedOn(computer.id, 'updates.apply'))
      } catch (reason) {
        notifyError(errorText(reason), computer.name)
      }
    }
    const here = pending.find((row) => row.computer.local && row.summary.nextVersion)
    if (here)
      await invokeUncachedOn(here.computer.id, 'updates.apply')
        .then((result) => reportRamu(here.computer.name, result))
        .catch((reason) => notifyError(errorText(reason), here.computer.name))
    setBusy(false)
    setPending([])
  }
  return (
    <>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
        <Download size={14} />
        {busy ? t('Updating…') : t('Update all hosts ({0})', { 0: pending.length })}
      </Button>
      {confirming && (
        <ConfirmDialog
          title={t('Update {0} hosts?', { 0: pending.length })}
          confirmLabel={t('Update all')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void run()
          }}
        >
          <p className="m-0 text-caption text-muted-foreground">
            {[
              t(
                'Provider CLIs update on each host, then Ramu installs where a newer release exists and restarts there.',
              ),
              running
                ? t(
                    '{0} threads are working on those hosts. Threads continue after the restart when Continue threads after restart is on.',
                    { 0: running },
                  )
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
          <ul className="m-[8px_0_0] pl-4 text-caption">
            {pending.map(({ computer, summary }) => (
              <li key={computer.id}>
                {computer.name}:{' '}
                {[
                  summary.nextVersion ? t('Ramu {0}', { 0: summary.nextVersion }) : null,
                  ...summary.providers.map((entry) => providerName(entry.provider)),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </>
  )
}
