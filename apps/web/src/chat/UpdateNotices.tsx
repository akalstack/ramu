import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Loader2 } from 'lucide-react'
import type { Computer } from '@ramu/shared/types'
import { providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import { pendingProviderUpdates, providerUpdateKey, type PendingProviderUpdate } from '@ramu/shared/updates'
import { notify, type AppToastData } from '@/components/app-toaster'
import { ProviderIcon } from '../models/ProviderIcon'
import { Dialog } from '../Menu'
import { Button } from '@/components/desktop-button'
import { bridge, invokeUncachedOn } from '../ipc'
import { ownHostId } from '../hosts'
import { useComputers } from '../workspace/computers'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { TOAST_MS, notices } from './notificationCenter'

const NOTICE_ID = 'updates'
/** Hosts push their provider checks; this catches a host whose push never reached this window. */
const RECHECK_MS = 30 * 60_000

type Host = Pick<Computer, 'id' | 'name' | 'local' | 'running'>

/** One thing the notice can update: a provider CLI on a host, or Ramu itself on another host. */
type Job =
  { kind: 'provider'; host: string; update: PendingProviderUpdate } | { kind: 'ramu'; host: string; version: string }

const jobKey = (job: Job) =>
  job.kind === 'provider' ? providerUpdateKey(job.update) : `ramu:${job.host}:${job.version}`
const jobName = (job: Job) => (job.kind === 'provider' ? providerName(job.update.provider) : 'Ramu')

/**
 * Every update the connected hosts offer, as one notice with one Update all: provider CLIs on any host, and a newer Ramu
 * on another host (this computer's own release is the status bar's). On each host the provider CLIs go first, one at a
 * time since installers share global package folders, then Ramu, whose install restarts that host; hosts run side by
 * side. Restarting a host with threads working is confirmed first. The notice shows how far it has got, and only what
 * failed is offered again.
 */
export function UpdateNotices({ providerChecks }: { providerChecks: boolean }) {
  useLanguage()
  const computers = useComputers()
  const hosts = useMemo<Host[]>(() => {
    const reachable = computers?.computers.filter((host) => host.local || host.status === 'connected')
    return reachable?.length ? reachable : [{ id: ownHostId(), name: '', local: true, running: 0 }]
  }, [computers])
  const key = hosts.map((host) => host.id).join(',')
  const several = hosts.length > 1
  const nameOf = (id: string) => hosts.find((host) => host.id === id)?.name || t('This host')
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ProviderStatus[]>>(new Map())
  const [releases, setReleases] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [confirming, setConfirming] = useState<Job[] | null>(null)
  // The update list, while it is open: what it showed when opened, so finished rows stay to say they are done.
  const [picking, setPicking] = useState<Job[] | null>(null)
  // Each row's last run: running, done, or why it failed.
  const [rows, setRows] = useState<ReadonlyMap<string, 'running' | 'done' | { error: string }>>(new Map())
  const mark = (job: Job, state: 'running' | 'done' | { error: string }) =>
    setRows((current) => new Map(current).set(jobKey(job), state))

  const readProviders = (host: string) =>
    void invokeUncachedOn(host, 'providers.updates').then(
      (list) => setStatuses((current) => new Map(current).set(host, list)),
      () => {},
    )
  const readRelease = (host: string) =>
    void invokeUncachedOn(host, 'updates.status').then(
      (status) => setReleases((current) => new Map(current).set(host, status.release?.version ?? null)),
      () => {},
    )
  useEffect(() => {
    // Hosts that left drop their updates with them.
    const here = (id: string) => hosts.some((host) => host.id === id)
    setStatuses((current) => new Map([...current].filter(([id]) => providerChecks && here(id))))
    setReleases((current) => new Map([...current].filter(([id]) => here(id))))
    const read = () => {
      for (const host of hosts) {
        if (providerChecks) readProviders(host.id)
        if (!host.local) readRelease(host.id)
      }
    }
    const off = providerChecks
      ? bridge.on('providers:updates', (list, from) => {
          const host = from ?? ownHostId()
          if (here(host)) setStatuses((current) => new Map(current).set(host, list))
        })
      : () => {}
    read()
    const timer = setInterval(read, RECHECK_MS)
    return () => {
      off()
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the connected hosts
  }, [providerChecks, key])

  const jobs = useMemo<Job[]>(() => {
    const providers = pendingProviderUpdates(
      hosts.map((host) => [host.id, statuses.get(host.id) ?? []] as const),
      new Set(),
    )
    return hosts
      .flatMap((host): Job[] => {
        const version = host.local ? null : releases.get(host.id)
        return [
          ...providers
            .filter((update) => update.host === host.id)
            .map((update): Job => ({ kind: 'provider', host: host.id, update })),
          ...(version ? [{ kind: 'ramu', host: host.id, version } as const] : []),
        ]
      })
      .filter((job) => !dismissed.has(jobKey(job)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the connected hosts
  }, [statuses, releases, dismissed, key])

  const where = (job: Job) => (several ? `${jobName(job)} (${nameOf(job.host)})` : jobName(job))
  const shown = useRef('')
  const run = async (list: Job[]) => {
    if (progress || !list.length) return
    let done = 0
    const failed: { job: Job; reason: string }[] = []
    const restarted: string[] = []
    const byHost = new Map<string, Job[]>()
    for (const job of list) byHost.set(job.host, [...(byHost.get(job.host) ?? []), job])
    setProgress({ done, total: list.length, current: where(list[0]!) })
    await Promise.all(
      [...byHost].map(async ([host, hostJobs]) => {
        // Ramu last on a host: its install restarts the host, which would cut off the provider updates.
        for (const job of [...hostJobs].sort((a, b) => Number(a.kind === 'ramu') - Number(b.kind === 'ramu'))) {
          setProgress({ done, total: list.length, current: where(job) })
          mark(job, 'running')
          try {
            if (job.kind === 'provider') await invokeUncachedOn(host, 'providers.update', job.update.provider)
            else {
              const result = await invokeUncachedOn(host, 'updates.apply')
              if (result.outcome === 'unavailable') throw new Error(result.message)
              restarted.push(`${nameOf(host)}: ${result.message}`)
            }
            mark(job, 'done')
          } catch (reason) {
            failed.push({ job, reason: errorText(reason) })
            mark(job, { error: errorText(reason) })
          }
          done++
          setProgress({ done, total: list.length, current: where(job) })
        }
        // Each host pushes its new state too; reading it here keeps the notice right when that push is missed.
        if (providerChecks) readProviders(host)
        if (hostJobs.some((job) => job.kind === 'ramu')) readRelease(host)
      }),
    )
    setProgress(null)
    shown.current = ''
    if (!failed.length) {
      notify.close(NOTICE_ID)
      notices.remove(NOTICE_ID)
      notify.add({
        type: 'success',
        title:
          list.length === 1
            ? t('{0} updated', { '0': where(list[0]!) })
            : t('{0} updates installed', { '0': list.length }),
        description: restarted.join(' · ') || undefined,
        timeout: TOAST_MS.success,
      })
      return
    }
    const retry = failed.map((entry) => entry.job)
    const title =
      failed.length === 1
        ? t('Could not update {0}', { '0': where(retry[0]!) })
        : t('{0} of {1} updates failed', { '0': failed.length, '1': list.length })
    const description = failed
      .map((entry) => (failed.length === 1 ? entry.reason : `${where(entry.job)}: ${entry.reason}`))
      .join(' · ')
    const again = () => void latest.current.start(retry)
    notify.add({
      id: NOTICE_ID,
      type: 'error',
      title,
      description,
      timeout: TOAST_MS.error,
      data: {},
      actionProps: { children: t('Try again'), onClick: again },
    })
    notices.add({ id: NOTICE_ID, title, description, type: 'error', actionLabel: t('Try again'), onAction: again })
  }
  /** Restarting a host where threads are working is a choice; everything else starts at once. */
  const start = (list: Job[]) => {
    const busy = list.some(
      (job) => job.kind === 'ramu' && (hosts.find((host) => host.id === job.host)?.running ?? 0) > 0,
    )
    if (busy) setConfirming(list)
    else void run(list)
  }
  const pick = () => setPicking(latest.current.jobs)
  const latest = useRef({ jobs, start, pick })
  latest.current = { jobs, start, pick }

  // The notice follows the list: something new pops it up again, a shorter list updates it quietly.
  useEffect(() => {
    if (progress) {
      notify.update(NOTICE_ID, {
        type: 'loading',
        title:
          progress.total === 1
            ? t('Updating {0}…', { '0': progress.current })
            : t('Updating {0} of {1}…', { '0': Math.min(progress.done + 1, progress.total), '1': progress.total }),
        description: progress.total === 1 ? undefined : progress.current,
        timeout: 0,
        // The spinner shows only while no icon of its own covers it.
        data: {},
        actionProps: undefined,
      })
      return
    }
    const listKey = jobs.map(jobKey).join('|')
    if (listKey === shown.current) return
    const before = new Set(shown.current.split('|'))
    const grown = jobs.some((job) => !before.has(jobKey(job)))
    shown.current = listKey
    if (!jobs.length) {
      notify.close(NOTICE_ID)
      notices.remove(NOTICE_ID)
      return
    }
    const one = jobs.length === 1 ? jobs[0]! : null
    const title = !one
      ? t('{0} updates available', { '0': jobs.length })
      : one.kind === 'provider'
        ? `${providerName(one.update.provider)}${t(' update available')}`
        : t('Ramu {0} is available on {1}', { '0': one.version, '1': nameOf(one.host) })
    const label = (job: Job) =>
      job.kind === 'ramu'
        ? t('Ramu {0}', { '0': job.version })
        : job.update.version
          ? `${providerName(job.update.provider)} ${job.update.version} → ${job.update.latest}`
          : `${providerName(job.update.provider)} ${job.update.latest}`
    const description = one
      ? one.kind === 'ramu'
        ? t('Updating restarts that host; it reconnects by itself.')
        : `${one.update.version ? `${one.update.version} → ${one.update.latest}` : one.update.latest}${several ? ` · ${nameOf(one.host)}` : ''}`
      : several
        ? [...new Set(jobs.map((job) => job.host))]
            .map(
              (host) =>
                `${nameOf(host)}: ${jobs
                  .filter((job) => job.host === host)
                  .map(jobName)
                  .join(', ')}`,
            )
            .join(' · ')
        : jobs.map(label).join(' · ')
    const providers = [...new Set(jobs.map((job) => (job.kind === 'provider' ? job.update.provider : null)))]
    const icon =
      providers.length === 1 && providers[0] ? (
        <ProviderIcon provider={providers[0]} size={18} />
      ) : (
        <Download size={16} />
      )
    const action = one ? t('Update') : t('Update all')
    const install = () => latest.current.start(latest.current.jobs)
    // Several updates can also be taken one at a time, from the list.
    const choose = one ? undefined : { label: t('Choose'), onClick: () => latest.current.pick() }
    // Dismissing hides these versions; a provider's is hidden on its host for every device, and a newer one comes back.
    const dismiss = () => {
      const current = latest.current.jobs
      setDismissed((set) => new Set([...set, ...current.map(jobKey)]))
      for (const job of current)
        if (job.kind === 'provider')
          void invokeUncachedOn(
            job.host,
            'providers.dismissUpdate',
            job.update.provider,
            job.update.binary,
            job.update.latest,
          ).catch(() => {})
      notify.close(NOTICE_ID)
      notices.remove(NOTICE_ID)
    }
    const toast = {
      type: 'info',
      title,
      description,
      data: { icon, onDismiss: dismiss, secondary: choose } satisfies AppToastData,
      actionProps: { children: action, onClick: install },
    }
    if (grown) notify.add<AppToastData>({ id: NOTICE_ID, timeout: TOAST_MS.update, ...toast })
    else notify.update(NOTICE_ID, toast)
    notices.add({
      id: NOTICE_ID,
      title,
      description,
      type: 'info',
      icon,
      actionLabel: action,
      onAction: install,
      secondaryLabel: choose?.label,
      onSecondary: choose?.onClick,
      onDismiss: dismiss,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the notice is rebuilt from the list and the run state
  }, [jobs, progress])

  useEffect(
    () => () => {
      notify.close(NOTICE_ID)
      notices.remove(NOTICE_ID)
    },
    [],
  )

  if (confirming) {
    const busyHosts = hosts.filter(
      (host) => host.running > 0 && confirming.some((job) => job.kind === 'ramu' && job.host === host.id),
    )
    return (
      <Dialog
        title={
          confirming.length === 1
            ? t('Update {0}?', { 0: nameOf(confirming[0]!.host) })
            : t('Install {0} updates?', { 0: confirming.length })
        }
        confirmLabel={confirming.length === 1 ? t('Update') : t('Update all')}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const list = confirming
          setConfirming(null)
          void run(list)
        }}
      >
        <p className="m-0 text-caption text-muted-foreground">
          {t(
            'Ramu restarts on {0}, where threads are working. Threads continue after the restart when Continue threads after restart is on.',
            { 0: busyHosts.map((host) => `${host.name} (${host.running})`).join(', ') },
          )}
        </p>
        <ul className="m-[8px_0_0] pl-4 text-caption">
          {[...new Set(confirming.map((job) => job.host))].map((host) => (
            <li key={host}>
              {nameOf(host)}:{' '}
              {confirming
                .filter((job) => job.host === host)
                .map((job) =>
                  job.kind === 'ramu' ? t('Ramu {0}', { 0: job.version }) : providerName(job.update.provider),
                )
                .join(', ')}
            </li>
          ))}
        </ul>
      </Dialog>
    )
  }
  if (!picking) return null
  // Rows found while the list is open join it; finished ones stay until it closes.
  const listed = [...picking, ...jobs.filter((job) => !picking.some((entry) => jobKey(entry) === jobKey(job)))]
  const remaining = listed.filter((job) => rows.get(jobKey(job)) !== 'done')
  const running = !!progress
  return (
    <Dialog
      title={t('Updates')}
      confirmLabel={t('Done')}
      cancellable={false}
      onCancel={() => setPicking(null)}
      onConfirm={() => setPicking(null)}
      footerLeading={
        remaining.length > 1 ? (
          <Button variant="secondary" size="sm" className="mr-auto" disabled={running} onClick={() => start(remaining)}>
            <Download size={13} />
            {t('Update all ({0})', { 0: remaining.length })}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {[...new Set(listed.map((job) => job.host))].map((host) => (
          <section key={host} className="flex flex-col gap-0.5" aria-label={nameOf(host)}>
            {several && (
              <h4 className="m-0 px-1 pb-0.5 text-caption font-medium text-muted-foreground">{nameOf(host)}</h4>
            )}
            {listed
              .filter((job) => job.host === host)
              .map((job) => {
                const state = rows.get(jobKey(job))
                const versions =
                  job.kind === 'ramu'
                    ? t('{0} · restarts {1}', { 0: job.version, 1: nameOf(job.host) })
                    : job.update.version
                      ? `${job.update.version} → ${job.update.latest}`
                      : job.update.latest
                return (
                  <div
                    key={jobKey(job)}
                    className="flex min-h-11 items-center gap-2.5 rounded-(--radius-s) px-1.5 hover:bg-hover"
                  >
                    {job.kind === 'provider' ? (
                      <ProviderIcon provider={job.update.provider} size={18} />
                    ) : (
                      <Download size={16} className="flex-none text-muted-foreground" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-control font-medium text-foreground">{jobName(job)}</span>
                      {typeof state === 'object' ? (
                        <span className="truncate text-caption text-bad" title={state.error}>
                          {state.error}
                        </span>
                      ) : (
                        <span className="truncate text-caption text-muted-foreground tabular-nums">{versions}</span>
                      )}
                    </span>
                    {state === 'running' ? (
                      <span className="flex flex-none items-center gap-1.5 text-caption text-muted-foreground">
                        <Loader2 size={13} className="animate-spin" /> {t('Updating…')}
                      </span>
                    ) : state === 'done' ? (
                      <span className="flex flex-none items-center gap-1 text-caption text-ok">
                        <Check size={13} /> {t('Updated')}
                      </span>
                    ) : (
                      <Button
                        variant={state ? 'outline' : 'secondary'}
                        size="xs"
                        className="flex-none"
                        disabled={running}
                        aria-label={`${state ? t('Try again') : t('Update')} ${where(job)}`}
                        onClick={() => start([job])}
                      >
                        {state ? t('Try again') : t('Update')}
                      </Button>
                    )}
                  </div>
                )
              })}
          </section>
        ))}
      </div>
    </Dialog>
  )
}
