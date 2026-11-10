import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, MemoryStick, Square, X } from 'lucide-react'
import {
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

const percent = (part: number, whole: number) => `${whole > 0 ? Math.min(100, (part / whole) * 100) : 0}%`

/** One part of a stacked bar, with its legend entry. */
interface Part {
  key: string
  label: string
  value: number
  text: string
  className: string
}

/**
 * One reading of the host as a stacked bar: Ramu's threads in the accent, Ramu itself lighter, other apps neutral and
 * what is left empty, with the total on the right and each part named under it.
 */
function Meter({
  title,
  total,
  summary,
  warning,
  parts,
}: {
  title: string
  total: number
  summary: string
  warning?: string
  parts: Part[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-control">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{title}</span>
        {warning && <span className="text-caption text-warn">{warning}</span>}
        <span className="flex-none text-caption text-muted-foreground tabular-nums" role="status">
          {summary}
        </span>
      </div>
      <div
        role="img"
        aria-label={[summary, ...parts.map((part) => `${part.label} ${part.text}`)].join(', ')}
        className="flex h-2 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        {parts
          .filter((part) => part.key !== 'free')
          .map((part) => (
            <span
              key={part.key}
              className={cn('h-full transition-[width] duration-500 ease-out', part.className)}
              style={{ width: percent(part.value, total) }}
            />
          ))}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-caption text-muted-foreground">
        {parts.map((part) => (
          <span key={part.key} className="inline-flex min-w-0 items-center gap-1.5 tabular-nums">
            <span aria-hidden="true" className={cn('size-2 flex-none rounded-full', part.className)} />
            <span className="truncate">{part.label}</span>
            <span className="ml-auto text-soft">{part.text}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** The host's memory and CPU, each showing Ramu's threads, Ramu itself and everything else running on it. */
function HostMeters({
  memory,
  threadBytes,
  ramuBytes,
  threadCpu,
  ramuCpu,
  hostCpu,
  cores,
}: {
  memory: HostMemory | null
  threadBytes: number
  ramuBytes: number
  threadCpu: number
  ramuCpu: number
  hostCpu?: number
  cores?: number
}) {
  const coreCount = Math.max(1, cores ?? 1)
  // `ps` reports 100 per busy core; the bar's whole is every core.
  const capacity = 100 * coreCount
  const allCpu = Math.max(hostCpu ?? 0, threadCpu + ramuCpu)
  const cpuPercent = (value: number) => `${Math.round(Math.min(100, (value / capacity) * 100))}%`
  const split = memory ? memoryBreakdown(memory, threadBytes, ramuBytes) : null
  return (
    <div className="@container flex flex-col gap-4">
      {memory && split && (
        <Meter
          title={t('Memory')}
          total={memory.totalBytes}
          summary={t('{0} of {1} GB used', {
            0: gigabytes(memory.totalBytes - memory.availableBytes),
            1: gigabytes(memory.totalBytes),
          })}
          warning={isLowMemory(memory) ? t('Low memory') : undefined}
          parts={[
            {
              key: 'threads',
              label: t('Threads'),
              value: split.threads,
              text: gigabytes(split.threads),
              className: 'bg-brand',
            },
            { key: 'ramu', label: t('Ramu'), value: split.ramu, text: gigabytes(split.ramu), className: 'bg-brand/40' },
            {
              key: 'other',
              label: t('Other apps'),
              value: split.other,
              text: gigabytes(split.other),
              className: isLowMemory(memory) ? 'bg-warn/70' : 'bg-foreground/30',
            },
            {
              key: 'free',
              label: t('Available'),
              value: split.free,
              text: gigabytes(split.free),
              className: 'bg-foreground/10',
            },
          ]}
        />
      )}
      <Meter
        title={t('CPU')}
        total={capacity}
        summary={t('{0} of {1} cores busy', { 0: cpuPercent(allCpu), 1: coreCount })}
        parts={[
          { key: 'threads', label: t('Threads'), value: threadCpu, text: cpuPercent(threadCpu), className: 'bg-brand' },
          { key: 'ramu', label: t('Ramu'), value: ramuCpu, text: cpuPercent(ramuCpu), className: 'bg-brand/40' },
          {
            key: 'other',
            label: t('Other apps'),
            value: Math.max(0, allCpu - threadCpu - ramuCpu),
            text: cpuPercent(Math.max(0, allCpu - threadCpu - ramuCpu)),
            className: 'bg-foreground/30',
          },
          {
            key: 'free',
            label: t('Idle'),
            value: Math.max(0, capacity - allCpu),
            text: cpuPercent(Math.max(0, capacity - allCpu)),
            className: 'bg-foreground/10',
          },
        ]}
      />
    </div>
  )
}

/** A thread's or Ramu's figures in the list's two columns. */
function Figures({ bytes, cpu, busy }: { bytes: number; cpu: number; busy?: boolean }) {
  return (
    <>
      <span className="w-14 flex-none text-right text-caption text-soft tabular-nums">
        {t('{0} GB', { 0: gigabytes(bytes) })}
      </span>
      <span className={cn('w-10 flex-none text-right text-caption tabular-nums', busy ? 'text-warn' : 'text-soft')}>
        {Math.round(cpu)}%
      </span>
    </>
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
  const name = item.kind === 'agent' ? t('Agent') : item.name
  return (
    <div className="flex min-h-7 items-center gap-2 pl-7 text-caption text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="w-14 flex-none text-right tabular-nums">{t('{0} GB', { 0: gigabytes(item.rssBytes) })}</span>
      <span className="w-10 flex-none" />
      <Button
        variant="ghost"
        size="icon-xs"
        className="w-12 flex-none"
        aria-label={t('Stop {0}', { 0: name })}
        title={t('Stop {0}', { 0: name })}
        onClick={() => void anyHost(hostId, method, ...args).then(onStopped, (error) => notifyError(errorText(error)))}
      >
        <Square size={11} />
      </Button>
    </div>
  )
}

const ACTIVITY_TEXT = {
  working: 'Working',
  idle: 'Idle',
  'left-running': 'Still running after its turn',
} as const

function ThreadRow({
  hostId,
  thread,
  task,
  servers,
  onStopped,
}: {
  hostId: string
  thread: ThreadResources
  task?: Task
  servers: ThreadServer[]
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
  const busy = isBusy(thread)
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
  const what = [
    t(ACTIVITY_TEXT[activity]),
    busy ? t('Busy') : '',
    servers.length ? (servers.length === 1 ? t('1 server') : t('{0} servers', { 0: servers.length })) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="flex flex-col">
      <div className="flex min-h-10 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-xs"
          className="flex-none"
          aria-expanded={open}
          aria-label={t('Show what {0} uses', { 0: title })}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-control text-foreground">{title}</span>
          <span
            className={cn(
              'truncate text-caption',
              activity === 'left-running' || busy ? 'text-warn' : 'text-muted-foreground',
            )}
          >
            {what}
          </span>
        </span>
        <Figures bytes={thread.rssBytes} cpu={thread.cpu} busy={busy} />
        {confirming ? (
          <Button
            size="xs"
            variant="destructive"
            className="flex-none"
            onClick={() => void stop()}
            onBlur={() => setConfirming(false)}
          >
            {t('Stop?')}
          </Button>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            className="w-12 flex-none"
            title={t('Stop everything {0} left running', { 0: title })}
            onClick={() => (activity === 'working' ? setConfirming(true) : void stop())}
          >
            {t('Stop')}
          </Button>
        )}
      </div>
      {open &&
        thread.items.map((item) => (
          <ItemRow key={item.id} hostId={hostId} thread={thread} item={item} onStopped={onStopped} />
        ))}
      {open && servers.length > 0 && (
        <ul className="my-0 ml-6 flex list-none flex-col p-0">
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

/**
 * Each host's memory and CPU against everything running on it, then what Ramu's threads hold, heaviest first, with
 * Ramu's own share last. A failed reading hides figures, never shows zero.
 */
function ResourcesPanel() {
  useLanguage()
  const resources = useResources()
  const computers = useComputers()
  const overviews = useHostOverviews(resources.snapshots.map((entry) => entry.id))
  const name = (id: string) => computers?.computers.find((computer) => computer.id === id)?.name ?? ''
  if (!resources.snapshots.length)
    return <p className="m-0 px-3.5 py-3 text-caption text-muted-foreground">{t('Reading resources…')}</p>
  return (
    <section className="flex flex-col gap-5 px-3.5 py-3" aria-label={t('Resources')}>
      {resources.snapshots.map(({ id, data, servers, refetch }, index) => {
        const ramuBytes = data.ramuBytes + (id === resources.current ? resources.appMemory : 0)
        const threadBytes = data.threads.reduce((sum, thread) => sum + thread.rssBytes, 0)
        const threadCpu = data.threads.reduce((sum, thread) => sum + thread.cpu, 0)
        return (
          <div key={id} className="flex flex-col gap-4">
            {resources.snapshots.length > 1 && (
              <h3 className="m-0 text-caption font-medium tracking-wide text-muted-foreground uppercase">{name(id)}</h3>
            )}
            <HostMeters
              memory={data.memory}
              threadBytes={threadBytes}
              ramuBytes={ramuBytes}
              threadCpu={threadCpu}
              ramuCpu={data.ramuCpu ?? 0}
              hostCpu={data.hostCpu}
              cores={data.cores}
            />
            <div className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-line pb-1 text-caption text-muted-foreground">
                <span className="min-w-0 flex-1">
                  {data.threads.length
                    ? t('Threads using it · {0}', { 0: data.threads.length })
                    : t('No thread is running anything')}
                </span>
                <span className="w-14 flex-none text-right">{t('Memory')}</span>
                <span className="w-10 flex-none text-right">{t('CPU')}</span>
                <span className="w-12 flex-none" />
              </div>
              {data.threads.map((thread) => (
                <ThreadRow
                  key={thread.taskId}
                  hostId={id}
                  thread={thread}
                  task={overviews[index]?.data?.tasks.find((task) => task.id === thread.taskId)}
                  servers={servers.filter((server) => server.taskId === thread.taskId)}
                  onStopped={refetch}
                />
              ))}
              <div className="flex min-h-10 items-center gap-2 border-t border-line">
                <span className="w-6 flex-none" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-control text-foreground">{t('Ramu')}</span>
                  <span className="truncate text-caption text-muted-foreground">
                    {t('The service, the app and its browser')}
                  </span>
                </span>
                <Figures bytes={ramuBytes} cpu={data.ramuCpu ?? 0} />
                <span className="w-12 flex-none" />
              </div>
            </div>
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
        className="w-[460px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-48px)] overflow-hidden gap-0 p-0 rounded-(--radius-m) border border-edge bg-card text-foreground text-body ring-0 shadow-(--shadow-float)"
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
        <div className="min-h-0 overflow-y-auto overscroll-contain max-h-[min(560px,calc(100vh-120px))]">
          {open && <ResourcesPanel />}
        </div>
      </PopoverContent>
    </Popover>
  )
}
