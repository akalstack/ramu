import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Globe, MemoryStick, Square, X } from 'lucide-react'
import {
  cpuShare,
  gigabytes,
  isBusy,
  isLowMemory,
  memoryBreakdown,
  stopItemCall,
  threadActivity,
  type HostMemory,
  type ResourceItem,
  type ThreadResources,
} from '@ramu/shared/resources'
import type { ThreadServer } from '@ramu/shared/servers'
import type { Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { notifyError } from './Notifications'
import { useStatusPanel } from './notificationCenter'
import { t, useLanguage } from '../i18n'
import { invokeOn, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { useComputers } from '../workspace/computers'
import { useHostOverviews } from '../workspace/hostOverview'
import { useHost } from '../workspace/HostProvider'
import { ServerRow, useOpenServer } from './ThreadServers'
import { cn } from 'cn'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
const anyHost = invokeOn as unknown as Invoke

const POLL_MS = 5000

/** Figures for every connected owner host, read only while this hook is mounted, so a closed panel runs no `ps`. */
function useResources() {
  const computers = useComputers()
  const ids = (computers?.computers ?? [])
    .filter((computer) => computer.status === 'connected' && (!computers?.scope || computer.id === computers.scope))
    .map((computer) => computer.id)
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['resources', id],
      queryFn: () => invokeOn(id, 'resources.snapshot'),
      refetchInterval: POLL_MS,
      retry: false,
    })),
  })
  const servers = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['servers', id, undefined],
      queryFn: () => invokeOn(id, 'servers.list'),
      refetchInterval: POLL_MS,
      retry: false,
    })),
  })
  const appMemory = useQueries({
    queries: [
      {
        queryKey: ['resources', 'app'],
        queryFn: () => ramu.invoke('computers.appMemory'),
        refetchInterval: POLL_MS,
        retry: false,
      },
    ],
  })[0]?.data
  return {
    current: computers?.current,
    appMemory: typeof appMemory === 'number' ? appMemory : 0,
    snapshots: ids.flatMap((id, index) => {
      const data = queries[index]?.data
      return data
        ? [
            {
              id,
              data,
              servers: servers[index]?.data ?? [],
              refetch: () => {
                void queries[index]!.refetch()
                void servers[index]?.refetch()
              },
            },
          ]
        : []
    }),
  }
}

function Figure({ bytes }: { bytes: number }) {
  return (
    <span className="flex-none text-caption text-muted-foreground tabular-nums">
      {t('{0} GB', { 0: gigabytes(bytes) })}
    </span>
  )
}

const percent = (part: number, whole: number) => `${whole > 0 ? (part / whole) * 100 : 0}%`

/** The host's memory as one bar: Ramu's threads in the accent, Ramu itself lighter, everything else neutral. */
function HostMeter({
  name,
  memory,
  threadBytes,
  ramuBytes,
  cpu,
  cores,
}: {
  name: string
  memory: HostMemory
  threadBytes: number
  ramuBytes: number
  cpu: number
  cores?: number
}) {
  const split = memoryBreakdown(memory, threadBytes, ramuBytes)
  const low = isLowMemory(memory)
  const used = memory.totalBytes - memory.availableBytes
  const parts = [
    { key: 'threads', label: t('Threads'), bytes: split.threads, className: 'bg-brand' },
    { key: 'ramu', label: t('Ramu'), bytes: split.ramu, className: 'bg-brand/40' },
    { key: 'other', label: t('Other apps'), bytes: split.other, className: low ? 'bg-warn/70' : 'bg-foreground/25' },
  ]
  const summary = t('{0} of {1} GB used', { 0: gigabytes(used), 1: gigabytes(memory.totalBytes) })
  return (
    <div className="flex flex-col gap-1.5 pb-1">
      <div className="flex items-baseline gap-2 text-caption">
        <span className="min-w-0 flex-1 truncate text-foreground">{name || t('Memory')}</span>
        {low && <span className="text-warn">{t('Low memory')}</span>}
        <span className="flex-none text-muted-foreground tabular-nums" role="status">
          {summary}
        </span>
      </div>
      <div
        role="img"
        aria-label={[
          summary,
          ...parts.map((part) => `${part.label} ${t('{0} GB', { 0: gigabytes(part.bytes) })}`),
        ].join(', ')}
        className="flex h-2 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        {parts.map((part) => (
          <span
            key={part.key}
            className={cn('h-full transition-[width] duration-500 ease-out', part.className)}
            style={{ width: percent(part.bytes, memory.totalBytes) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        {parts.map((part) => (
          <span key={part.key} className="inline-flex items-center gap-1.5 tabular-nums">
            <span aria-hidden="true" className={cn('size-2 rounded-full', part.className)} />
            {part.label} {gigabytes(part.bytes)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <span aria-hidden="true" className="size-2 rounded-full bg-foreground/10" />
          {t('Available')} {gigabytes(split.free)}
        </span>
        <span className="ml-auto tabular-nums" title={t('Ramu’s share of all CPU cores')}>
          {t('CPU {0}%', { 0: Math.round(cpuShare(cpu, cores) * 100) })}
        </span>
      </div>
    </div>
  )
}

/** A thread's memory next to the heaviest thread's, and its CPU where a full bar is one busy core. */
function ThreadMeters({ thread, heaviest }: { thread: ThreadResources; heaviest: number }) {
  const busy = isBusy(thread)
  return (
    <div className="flex items-center gap-3 pl-8 pr-1 text-caption text-muted-foreground tabular-nums">
      <span className="flex min-w-0 flex-1 items-center gap-2" title={t('Memory')}>
        <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
          <span
            className="block h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
            style={{ width: percent(thread.rssBytes, heaviest) }}
          />
        </span>
      </span>
      <span className="flex flex-none items-center gap-1.5" title={t('CPU, where a full bar is one core')}>
        <span className="h-1 w-8 overflow-hidden rounded-full bg-foreground/10">
          <span
            className={cn(
              'block h-full rounded-full transition-[width] duration-500 ease-out',
              busy ? 'bg-warn' : 'bg-foreground/40',
            )}
            style={{ width: percent(cpuShare(thread.cpu), 1) }}
          />
        </span>
        <span className={cn('w-10 text-right', busy && 'text-warn')}>{Math.round(thread.cpu)}%</span>
      </span>
    </div>
  )
}

function ItemRow({
  hostId,
  thread,
  item,
  onStopped,
}: {
  hostId: string
  thread: ThreadResources
  item: ResourceItem
  onStopped: () => void
}) {
  const [method, ...args] = stopItemCall(thread.taskId, item)
  return (
    <div className="flex min-h-7 items-center gap-2 pl-6 text-caption text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{item.kind === 'agent' ? t('Agent') : item.name}</span>
      <Figure bytes={item.rssBytes} />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('Stop {0}', { 0: item.kind === 'agent' ? t('Agent') : item.name })}
        onClick={() => void anyHost(hostId, method, ...args).then(onStopped, (error) => notifyError(errorText(error)))}
      >
        <Square size={11} />
      </Button>
    </div>
  )
}

function ThreadRow({
  hostId,
  thread,
  task,
  servers,
  heaviest,
  onStopped,
}: {
  hostId: string
  thread: ThreadResources
  task?: Task
  servers: ThreadServer[]
  heaviest: number
  onStopped: () => void
}) {
  const active = useHost().id
  const { local, open: openServer } = useOpenServer(hostId)
  const stopServer = (server: ThreadServer) =>
    void anyHost(hostId, 'servers.stop', server.taskId, server.pid, server.port).then(onStopped, (error) =>
      notifyError(errorText(error)),
    )
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const activity = threadActivity(task, thread)
  const stop = async () => {
    setConfirming(false)
    try {
      for (const item of thread.items) {
        const [method, ...args] = stopItemCall(thread.taskId, item)
        await anyHost(hostId, method, ...args)
      }
      onStopped()
    } catch (error) {
      notifyError(errorText(error))
    }
  }
  const title = task?.title ?? t('Thread')
  return (
    <div className="flex flex-col">
      <div className="flex min-h-9 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-expanded={open}
          aria-label={t('Show what {0} uses', { 0: title })}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Button>
        <span className="min-w-0 flex-1 truncate text-body">{title}</span>
        {servers.length > 0 && (
          <span className="inline-flex flex-none items-center gap-1 rounded-full bg-brand/10 px-1.5 text-caption text-brand tabular-nums">
            <Globe size={11} />
            {servers.length}
          </span>
        )}
        <span
          className={`flex-none text-caption ${activity === 'left-running' ? 'text-warn' : 'text-muted-foreground'}`}
        >
          {activity === 'working' ? t('Working') : activity === 'idle' ? t('Idle') : t('Still running')}
          {isBusy(thread) ? ` · ${t('Busy')}` : ''}
        </span>
        <Figure bytes={thread.rssBytes} />
        {confirming ? (
          <Button size="xs" variant="destructive" onClick={() => void stop()} onBlur={() => setConfirming(false)}>
            {t('Stop {0}?', { 0: title })}
          </Button>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => (activity === 'working' ? setConfirming(true) : void stop())}
          >
            {t('Stop')}
          </Button>
        )}
      </div>
      <ThreadMeters thread={thread} heaviest={heaviest} />
      {open &&
        thread.items.map((item) => (
          <ItemRow key={item.id} hostId={hostId} thread={thread} item={item} onStopped={onStopped} />
        ))}
      {open && servers.length > 0 && (
        <ul className="my-0 ml-5 flex list-none flex-col p-0">
          {servers.map((server) => (
            <ServerRow
              key={`${server.pid}:${server.port}`}
              server={server}
              local={local}
              // The browser pane belongs to the host on screen; another host's server opens in the person's browser.
              onOpen={(entry, external) =>
                hostId === active ? openServer(entry, external) : local && openServer(entry, true)
              }
              onStop={stopServer}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One line per host, then each thread by what it uses, heaviest first. A failed reading hides figures, never shows zero. */
function ResourcesPanel() {
  useLanguage()
  const resources = useResources()
  const computers = useComputers()
  const overviews = useHostOverviews(resources.snapshots.map((entry) => entry.id))
  const name = (id: string) => computers?.computers.find((computer) => computer.id === id)?.name ?? ''
  if (!resources.snapshots.length)
    return <p className="m-0 px-3.5 py-3 text-caption text-muted-foreground">{t('Reading resources…')}</p>
  return (
    <section className="flex flex-col gap-3 px-3.5 py-3" aria-label={t('Resources')}>
      {resources.snapshots.map(({ id, data, servers, refetch }, index) => {
        const ramuBytes = data.ramuBytes + (id === resources.current ? resources.appMemory : 0)
        const threadBytes = data.threads.reduce((sum, thread) => sum + thread.rssBytes, 0)
        const heaviest = Math.max(0, ...data.threads.map((thread) => thread.rssBytes))
        return (
          <div key={id} className="flex flex-col">
            {data.memory ? (
              <HostMeter
                name={resources.snapshots.length > 1 ? name(id) : ''}
                memory={data.memory}
                threadBytes={threadBytes}
                ramuBytes={ramuBytes}
                cpu={data.threads.reduce((sum, thread) => sum + thread.cpu, 0)}
                cores={data.cores}
              />
            ) : (
              <p className="m-0 text-caption text-muted-foreground" role="status">
                {[
                  resources.snapshots.length > 1 ? name(id) : '',
                  t('Ramu {0} GB', { 0: gigabytes(ramuBytes + threadBytes) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {data.threads.map((thread) => (
              <ThreadRow
                key={thread.taskId}
                hostId={id}
                thread={thread}
                task={overviews[index]?.data?.tasks.find((task) => task.id === thread.taskId)}
                servers={servers.filter((server) => server.taskId === thread.taskId)}
                heaviest={heaviest}
                onStopped={refetch}
              />
            ))}
            {ramuBytes > 0 && data.threads.length > 0 && (
              <div className="flex min-h-7 items-center gap-2 pl-6 text-caption text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{t('Ramu (service, browser)')}</span>
                <Figure bytes={ramuBytes} />
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

/**
 * Memory and what holds it, per host and thread, from the status bar beside notifications, where running work is
 * stopped too. The figures are read only while the panel is open.
 */
export function ResourcesStatus() {
  useLanguage()
  const [open, setOpen] = useState(false)
  const panelRef = useStatusPanel('resources', open)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="min-w-7 flex-none h-[22px] min-h-[22px] border-0 rounded-(--radius-s) bg-transparent px-1.5 py-0 text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:text-foreground aria-expanded:bg-hover [&_svg]:size-3.5"
          />
        }
        aria-label={t('Resources')}
        title={t('Resources')}
      >
        <MemoryStick data-icon="inline-start" />
      </PopoverTrigger>
      <PopoverContent
        ref={panelRef}
        side="top"
        align="end"
        sideOffset={8}
        className="w-[420px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-48px)] overflow-hidden gap-0 p-0 rounded-(--radius-m) border border-edge bg-card text-foreground text-body ring-0 shadow-(--shadow-float)"
      >
        <PopoverHeader className="flex-row items-center gap-3 px-3.5 py-2.5">
          <PopoverTitle className="m-0 flex-1 text-control leading-5 font-semibold">{t('Resources')}</PopoverTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 min-h-6 border-0 bg-transparent hover:bg-transparent shadow-none text-muted-foreground hover:text-foreground"
            aria-label={t('Close resources')}
            onClick={() => setOpen(false)}
          >
            <X data-icon="inline-start" />
          </Button>
        </PopoverHeader>
        <Separator />
        <div className="min-h-0 overflow-y-auto overscroll-contain max-h-96">{open && <ResourcesPanel />}</div>
      </PopoverContent>
    </Popover>
  )
}
