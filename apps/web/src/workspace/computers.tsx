import { ChevronsUpDown, Network, Settings2 } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type { Computer, ComputerStatus, Computers } from '@ramu/shared/types'
import { Menu, type MenuEntry } from '../Menu'
import { Switch } from '@/components/ui/switch'
import { routeName } from '@ramu/shared/networkLabel'
import { invoke, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'

let computerState: Computers | null = null
let started = false,
  revision = 0
const listeners = new Set<() => void>()
const publishComputers = (value: Computers) => {
  revision++
  computerState = value
  for (const listener of listeners) listener()
}
function subscribeComputers(listener: () => void) {
  listeners.add(listener)
  if (!started) {
    started = true
    const request = revision
    ramu.on('computers:changed', publishComputers)
    void invoke('computers.list').then(
      (value) => {
        // The preload learns its host from a command-line argument; flag a mismatch, since keys and storage depend on it.
        if (value.current !== ramu.hostId) console.warn(`Window host ${ramu.hostId} differs from ${value.current}`)
        if (request === revision) publishComputers(value)
      },
      () => {},
    )
  }
  return () => {
    listeners.delete(listener)
  }
}
/** One shared computer snapshot per renderer, regardless of how many components display it. */
export function useComputers(): Computers | null {
  return useSyncExternalStore(subscribeComputers, () => computerState)
}

/** Whether this window's computer is temporarily unreachable. A rejected pairing never comes back, so it doesn't count. */
export function useHostConnection(): { offline: boolean; name: string } {
  const state = useComputers()
  const host = state?.computers.find((computer) => computer.id === state.current)
  return {
    offline: !!host && host.status !== 'connected' && host.status !== 'rejected',
    name: host?.name ?? t('this host'),
  }
}

export const statusText = (status: ComputerStatus) =>
  status === 'connected'
    ? t('Connected')
    : status === 'connecting'
      ? t('Connecting…')
      : status === 'offline'
        ? t('Offline')
        : status === 'paused'
          ? t('Paused')
          : t('Pair again')

export function StatusDot({ status, className = '' }: { status: ComputerStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={`size-1.5 flex-none rounded-full ${status === 'connected' ? 'bg-(--ok)' : status === 'rejected' ? 'bg-bad' : 'bg-muted-foreground'} ${status === 'connecting' ? 'animate-pulse' : ''} ${className}`}
    />
  )
}

/** What is going on over there, in the fewest words. */
export function activityText(computer: Pick<Computer, 'status' | 'running' | 'needsInput' | 'waiting'>): string {
  if (computer.status !== 'connected')
    return computer.status === 'offline' && computer.waiting === 'network'
      ? t('Waiting for network')
      : statusText(computer.status)
  const parts = [
    computer.needsInput ? t('{0} waiting', { 0: computer.needsInput }) : '',
    computer.running ? t('{0} working', { 0: computer.running }) : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

/** How this device reaches a host right now, as "via LAN", "via Ramu Link" and so on; empty for this computer. */
export function hostRoute(computer: Pick<Computer, 'local' | 'url' | 'ssh' | 'status'>): string {
  if (computer.local || computer.status !== 'connected') return ''
  const route = routeName(computer.url, computer.ssh)
  return route ? t('via {0}', { 0: t(route) }) : ''
}

/** The shared browsing filter is independent of the computer running the active chat. */
export function ComputerSwitcher() {
  useLanguage()
  const state = useComputers()
  if (!state || state.computers.length < 2) return null
  const selected = state.computers.find((computer) => computer.id === state.scope)
  const select = (id: string | null) =>
    void invoke('computers.scope', id)
      .then(publishComputers)
      .catch((error) => notifyError(errorText(error), t('Hosts')))
  const items: MenuEntry[] = [
    {
      key: 'all',
      selected: !selected,
      label: (
        <>
          <Network size={15} />
          <span className="grow">{t('All hosts')}</span>
        </>
      ),
      onSelect: () => select(null),
    },
    { key: 'hosts-separator', separator: true },
    ...state.computers.map((computer): MenuEntry => ({
      key: computer.id,
      selected: computer.id === selected?.id,
      title: computer.url ?? undefined,
      onSelect: () => select(computer.id),
      label: (
        <span className="flex w-full min-w-0 items-center gap-2">
          <StatusDot status={computer.status} />
          <span className="min-w-0 grow truncate">{computer.name}</span>
          <span className="ml-auto flex-none pl-3 text-right text-caption text-muted-foreground tabular-nums">
            {[activityText(computer), hostRoute(computer)].filter(Boolean).join(' · ')}
          </span>
          {!computer.local && computer.status !== 'rejected' && (
            // Turns the connection off and on from here; the click must not also pick this host.
            <span
              className="flex flex-none items-center"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Switch
                size="sm"
                aria-label={t('Keep {0} connected', { 0: computer.name })}
                checked={computer.status !== 'paused'}
                onCheckedChange={(on) =>
                  void invoke('computers.update', computer.id, { enabled: on })
                    .then(publishComputers)
                    .catch((error) => notifyError(errorText(error), t('Hosts')))
                }
              />
            </span>
          )}
        </span>
      ),
    })),
    { key: 'separator', separator: true },
    {
      key: 'manage',
      label: (
        <>
          <Settings2 />
          {t('Manage hosts…')}
        </>
      ),
      onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'remote' } })),
    },
  ]
  return (
    <Menu
      standard
      label={t('Filter hosts')}
      align="start"
      items={items}
      menuClassName="min-w-[260px]"
      className="computer-switcher flex w-full min-w-0 items-center justify-start gap-[9px] rounded-(--radius-row) border-0 bg-transparent p-[5px_8px] min-h-8 text-body leading-5 text-soft hover:bg-accent hover:text-foreground aria-expanded:bg-accent [-webkit-app-region:no-drag]"
      icon={
        <>
          <Network size={15} className="flex-none" />
          <span className="min-w-0 grow truncate text-left">{selected?.name ?? t('All hosts')}</span>
          {selected && <StatusDot status={selected.status} />}
          <ChevronsUpDown size={13} className="flex-none text-muted-foreground" />
        </>
      }
    />
  )
}
