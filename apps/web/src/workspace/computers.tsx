import { ChevronsUpDown, Monitor, Network, Settings2 } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type { Computer, ComputerStatus, Computers } from '@ramu/shared/types'
import { Menu, type MenuEntry } from '../Menu'
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
    name: host?.name ?? t('this computer'),
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
      className={`size-1.5 flex-none rounded-full ${status === 'connected' ? 'bg-(--ok)' : status === 'rejected' ? 'bg-bad' : 'bg-[#8b8b91]'} ${status === 'connecting' ? 'animate-pulse' : ''} ${className}`}
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

/**
 * Sidebar row that names the computer this window shows and switches to another one. It appears only once a second
 * computer is paired, so people who use one computer see no change. Every computer stays connected behind it.
 */
export function ComputerSwitcher() {
  useLanguage()
  const state = useComputers()
  if (!state || state.computers.length < 2) return null
  const current = state.computers.find((computer) => computer.id === state.current) ?? state.computers[0]!
  const others = state.computers.filter((computer) => computer.id !== current.id)
  const waiting = others.reduce((sum, computer) => sum + computer.needsInput, 0),
    working = others.reduce((sum, computer) => sum + computer.running, 0)
  const open = (id: string) =>
    void invoke('computers.open', id).catch((error) => notifyError(errorText(error), t('Computers')))
  const items: MenuEntry[] = [
    { key: 'heading', heading: t('Computers') },
    ...state.computers.map((computer): MenuEntry => ({
      key: computer.id,
      selected: computer.id === current.id,
      disabled: !computer.local && computer.id !== current.id && computer.status !== 'connected',
      title: computer.url ?? undefined,
      onSelect: () => {
        if (computer.id !== current.id) open(computer.id)
      },
      label: (
        <span className="flex min-w-0 grow items-center gap-2">
          <StatusDot status={computer.status} />
          <span className="truncate">{computer.name}</span>
          <span className="ml-auto flex-none pl-3 text-caption text-muted-foreground tabular-nums">
            {activityText(computer)}
          </span>
        </span>
      ),
    })),
    { key: 'separator', separator: true },
    {
      key: 'manage',
      label: (
        <>
          <Settings2 />
          {t('Manage computers…')}
        </>
      ),
      onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'remote' } })),
    },
  ]
  return (
    <Menu
      standard
      label={t('Switch computer')}
      align="start"
      items={items}
      menuClassName="min-w-[260px]"
      className="computer-switcher flex w-full min-w-0 items-center justify-start gap-[9px] rounded-(--radius-row) border-0 bg-transparent p-[5px_8px] min-h-8 text-body leading-5 text-soft hover:bg-accent hover:text-foreground aria-expanded:bg-accent [-webkit-app-region:no-drag]"
      icon={
        <>
          {current.local ? (
            <Monitor size={15} className="flex-none" />
          ) : (
            <Network size={15} className="flex-none text-(--accent)" />
          )}
          <span className="min-w-0 grow truncate text-left">{current.name}</span>
          {!current.local && (
            <span className="flex-none rounded-full bg-primary/10 px-1.5 text-[10px] font-medium leading-[16px] text-(--accent)">
              {current.ssh ? t('SSH') : t('Remote')}
            </span>
          )}
          <StatusDot status={current.status} />
          {(waiting > 0 || working > 0) && (
            <span
              className="flex-none rounded-full bg-fill px-1.5 text-[10px] leading-[16px] tabular-nums text-muted-foreground"
              title={[
                waiting ? t('{0} waiting on other computers', { 0: waiting }) : '',
                working ? t('{0} working on other computers', { 0: working }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              {waiting || working}
            </span>
          )}
          <ChevronsUpDown size={13} className="flex-none text-muted-foreground" />
        </>
      }
    />
  )
}
