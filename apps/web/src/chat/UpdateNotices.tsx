import { useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import type { Computer } from '@ramu/shared/types'
import { providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import {
  pendingProviderUpdates,
  providerUpdateKey,
  type AppUpdateStatus,
  type PendingProviderUpdate,
} from '@ramu/shared/updates'
import { notify, type AppToastData } from '@/components/app-toaster'
import { ProviderIcon } from '../models/ProviderIcon'
import { bridge, invokeUncachedOn } from '../ipc'
import { ownHostId } from '../hosts'
import { useComputers } from '../workspace/computers'
import { errorText } from '../lib/errors'
import { t } from '../i18n'
import { TOAST_MS, notices } from './notificationCenter'

const PROVIDERS_ID = 'provider-updates'
/** Hosts push their provider checks; this catches a host whose push never reached this window. */
const RECHECK_MS = 30 * 60_000

type Host = Pick<Computer, 'id' | 'name' | 'local' | 'running'>

const hostsKey = (hosts: Host[]) => hosts.map((host) => host.id).join(',')

/** `Codex 0.4 → 0.5`, or just its name when the installed version is unknown. */
const versionLine = (update: PendingProviderUpdate) =>
  update.version
    ? `${providerName(update.provider)} ${update.version} → ${update.latest}`
    : `${providerName(update.provider)} ${update.latest}`

/**
 * Provider CLI updates on every connected host as one notice with one Update all, and a newer Ramu on another host as a
 * notice of its own. Updates run one at a time on a host (installers share global package folders) and side by side
 * across hosts; the notice shows how far it has got, and only the ones that failed are offered again.
 */
export function UpdateNotices({ providerChecks }: { providerChecks: boolean }) {
  const computers = useComputers()
  const hosts = useMemo<Host[]>(() => {
    const reachable = computers?.computers.filter((host) => host.local || host.status === 'connected')
    return reachable?.length ? reachable : [{ id: ownHostId(), name: '', local: true, running: 0 }]
  }, [computers])
  const key = hostsKey(hosts)
  const several = hosts.length > 1
  const nameOf = (id: string) => hosts.find((host) => host.id === id)?.name || t('This host')
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ProviderStatus[]>>(new Map())
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  useEffect(() => {
    if (!providerChecks) return setStatuses(new Map())
    let live = true
    const take = (host: string, list: ProviderStatus[]) => {
      if (!live) return
      setStatuses((current) => new Map(current).set(host, list))
    }
    const read = () => {
      for (const host of hosts)
        void invokeUncachedOn(host.id, 'providers.updates').then(
          (list) => take(host.id, list),
          () => {},
        )
    }
    // Hosts that left drop their updates with them.
    setStatuses((current) => new Map([...current].filter(([id]) => hosts.some((host) => host.id === id))))
    const off = bridge.on('providers:updates', (list, from) => {
      const host = from ?? ownHostId()
      if (hosts.some((entry) => entry.id === host)) take(host, list)
    })
    read()
    const timer = setInterval(read, RECHECK_MS)
    return () => {
      live = false
      off()
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the connected hosts
  }, [providerChecks, key])

  const pending = useMemo(
    () =>
      pendingProviderUpdates(
        hosts.map((host) => [host.id, statuses.get(host.id) ?? []] as const),
        dismissed,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the connected hosts
    [statuses, dismissed, key],
  )

  const shown = useRef('')
  const latest = useRef({ pending, run: (_list: PendingProviderUpdate[]) => {} })
  const run = async (list: PendingProviderUpdate[]) => {
    if (progress || !list.length) return
    let done = 0
    const failed: { update: PendingProviderUpdate; reason: string }[] = []
    setProgress({ done, total: list.length, current: providerName(list[0]!.provider) })
    const byHost = new Map<string, PendingProviderUpdate[]>()
    for (const update of list) byHost.set(update.host, [...(byHost.get(update.host) ?? []), update])
    await Promise.all(
      [...byHost].map(async ([host, updates]) => {
        for (const update of updates) {
          setProgress({ done, total: list.length, current: providerName(update.provider) })
          try {
            await invokeUncachedOn(host, 'providers.update', update.provider)
          } catch (reason) {
            failed.push({ update, reason: errorText(reason) })
          }
          done++
          setProgress({ done, total: list.length, current: providerName(update.provider) })
        }
        // The host pushes its new list too; reading it here keeps the notice right when that push is missed.
        void invokeUncachedOn(host, 'providers.updates').then(
          (next) => setStatuses((current) => new Map(current).set(host, next)),
          () => {},
        )
      }),
    )
    setProgress(null)
    shown.current = ''
    const where = (update: PendingProviderUpdate) =>
      several ? `${providerName(update.provider)} (${nameOf(update.host)})` : providerName(update.provider)
    if (!failed.length) {
      notify.close(PROVIDERS_ID)
      notices.remove(PROVIDERS_ID)
      notify.add({
        type: 'success',
        title:
          list.length === 1
            ? t('{0} updated', { '0': where(list[0]!) })
            : t('{0} providers updated', { '0': list.length }),
        timeout: TOAST_MS.success,
      })
      return
    }
    const retry = failed.map((entry) => entry.update)
    const title =
      failed.length === 1
        ? t('Could not update {0}', { '0': where(retry[0]!) })
        : t('{0} of {1} updates failed', { '0': failed.length, '1': list.length })
    const description = failed
      .map((entry) => (failed.length === 1 ? entry.reason : `${where(entry.update)}: ${entry.reason}`))
      .join('\n')
    notify.add({
      id: PROVIDERS_ID,
      type: 'error',
      title,
      description,
      timeout: TOAST_MS.error,
      actionProps: { children: t('Try again'), onClick: () => void latest.current.run(retry) },
    })
    notices.add({
      id: PROVIDERS_ID,
      title,
      description,
      type: 'error',
      actionLabel: t('Try again'),
      onAction: () => void latest.current.run(retry),
    })
  }
  latest.current = { pending, run }

  // The notice follows the list: a new version pops it up again, a shorter list updates it quietly.
  useEffect(() => {
    if (progress) {
      notify.update(PROVIDERS_ID, {
        type: 'loading',
        title:
          progress.total === 1
            ? t('Updating {0}…', { '0': progress.current })
            : t('Updating providers… {0} of {1}', {
                '0': Math.min(progress.done + 1, progress.total),
                '1': progress.total,
              }),
        description: progress.total === 1 ? undefined : progress.current,
        timeout: 0,
        // The spinner shows only while no icon of its own covers it.
        data: {},
        actionProps: undefined,
      })
      return
    }
    const keyOfList = pending.map(providerUpdateKey).join('|')
    if (keyOfList === shown.current) return
    const before = new Set(shown.current.split('|'))
    const grown = pending.some((update) => !before.has(providerUpdateKey(update)))
    shown.current = keyOfList
    if (!pending.length) {
      notify.close(PROVIDERS_ID)
      notices.remove(PROVIDERS_ID)
      return
    }
    const one = pending.length === 1 ? pending[0]! : null
    const providers = [...new Set(pending.map((update) => update.provider))]
    const title = one
      ? `${providerName(one.provider)}${t(' update available')}`
      : t('{0} provider updates', { '0': pending.length })
    const description = one
      ? `${one.version ? `${one.version} → ${one.latest}` : one.latest}${several ? ` · ${nameOf(one.host)}` : ''}`
      : several
        ? [...new Set(pending.map((update) => update.host))]
            .map(
              (host) =>
                `${nameOf(host)}: ${pending
                  .filter((update) => update.host === host)
                  .map((update) => providerName(update.provider))
                  .join(', ')}`,
            )
            .join(' · ')
        : pending.map(versionLine).join(' · ')
    const icon = providers.length === 1 ? <ProviderIcon provider={providers[0]!} size={18} /> : <Download size={16} />
    const action = one ? t('Update') : t('Update all')
    const install = () => void latest.current.run(latest.current.pending)
    // Dismissing hides these versions on their hosts for every device; a newer version is offered again.
    const dismiss = () => {
      const current = latest.current.pending
      setDismissed((set) => new Set([...set, ...current.map(providerUpdateKey)]))
      for (const update of current)
        void invokeUncachedOn(
          update.host,
          'providers.dismissUpdate',
          update.provider,
          update.binary,
          update.latest,
        ).catch(() => {})
      notify.close(PROVIDERS_ID)
      notices.remove(PROVIDERS_ID)
    }
    const toast = {
      type: 'info',
      title,
      description,
      data: { icon, onDismiss: dismiss } satisfies AppToastData,
      actionProps: { children: action, onClick: install },
    }
    if (grown) notify.add<AppToastData>({ id: PROVIDERS_ID, timeout: TOAST_MS.update, ...toast })
    else notify.update(PROVIDERS_ID, toast)
    notices.add({
      id: PROVIDERS_ID,
      title,
      description,
      type: 'info',
      icon,
      actionLabel: action,
      onAction: install,
      onDismiss: dismiss,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the notice is rebuilt from the list and the run state
  }, [pending, progress])

  useEffect(
    () => () => {
      notify.close(PROVIDERS_ID)
      notices.remove(PROVIDERS_ID)
    },
    [],
  )

  return (
    <>
      {hosts
        .filter((host) => !host.local)
        .map((host) => (
          <RamuUpdateNotice key={host.id} host={host} />
        ))}
    </>
  )
}

/**
 * A newer Ramu on another connected host (this computer's own update is the status bar's). Update installs it there
 * at once when nothing is working; with threads working it opens the host's updates so the restart is a choice.
 */
function RamuUpdateNotice({ host }: { host: Host }) {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null)
  const id = `ramu-update:${host.id}`
  useEffect(() => {
    let live = true
    const read = () =>
      void invokeUncachedOn(host.id, 'updates.status').then(
        (next) => live && setStatus(next),
        () => {},
      )
    read()
    const timer = setInterval(read, RECHECK_MS)
    return () => {
      live = false
      clearInterval(timer)
      notify.close(id)
      notices.remove(id)
    }
  }, [host.id, id])
  const version = status?.release?.version
  const busy = host.running > 0
  useEffect(() => {
    if (!version) {
      notify.close(id)
      notices.remove(id)
      return
    }
    const title = t('Ramu {0} is available on {1}', { '0': version, '1': host.name })
    const description = busy
      ? t('{0} threads are working there. Updating restarts that host.', { '0': host.running })
      : t('Updating restarts that host; it reconnects by itself.')
    const review = () =>
      window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'remote', host: host.id } }))
    const install = () => {
      notify.update(id, {
        type: 'loading',
        title: t('Updating {0}…', { '0': host.name }),
        timeout: 0,
        data: {},
        actionProps: undefined,
      })
      void invokeUncachedOn(host.id, 'updates.apply').then(
        (result) => {
          notices.remove(id)
          if (result.outcome === 'unavailable') {
            notify.update(id, {
              type: 'error',
              title: t('Could not update {0}', { '0': host.name }),
              description: result.message,
              timeout: TOAST_MS.error,
              actionProps: result.notesUrl
                ? {
                    children: t('Open release'),
                    onClick: () => void bridge.invoke('app.openExternal', result.notesUrl!),
                  }
                : undefined,
            })
            return
          }
          notify.update(id, {
            type: 'success',
            title: host.name,
            description: result.message,
            timeout: TOAST_MS.success,
          })
          if (result.notesUrl) void bridge.invoke('app.openExternal', result.notesUrl).catch(() => {})
        },
        (reason) =>
          notify.update(id, {
            type: 'error',
            title: t('Could not update {0}', { '0': host.name }),
            description: errorText(reason),
            timeout: TOAST_MS.error,
            actionProps: { children: t('Try again'), onClick: install },
          }),
      )
    }
    const action = busy ? { label: t('Review'), run: review } : { label: t('Update'), run: install }
    notify.add<AppToastData>({
      id,
      title,
      description,
      timeout: TOAST_MS.update,
      data: { icon: <Download size={16} /> },
      actionProps: { children: action.label, onClick: action.run },
    })
    notices.add({
      id,
      title,
      description,
      type: 'info',
      icon: <Download size={16} />,
      actionLabel: action.label,
      onAction: action.run,
    })
  }, [version, busy, host.id, host.name, host.running, id])
  return null
}
