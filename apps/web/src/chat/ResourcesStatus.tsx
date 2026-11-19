import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ChevronDown, MemoryStick, Square, X } from 'lucide-react'
import {
  cpuPercent,
  isBusy,
  isLowMemory,
  leftoverLabel,
  memoryBreakdown,
  memorySize,
  stopItemCall,
  threadActivity,
  type HostMemory,
  type ResourceItem,
  type ThreadResources,
} from '@ramu/shared/resources'
import type { ThreadServer } from '@ramu/shared/servers'
import type { Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
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

/**
 * Figures for every connected owner host, read only while this hook is mounted, so a closed panel runs no `ps`. The
 * browsing filter only puts its host first: what a machine holds matters whichever host's threads are being browsed.
 */
function useResources() {
  const computers = useComputers()
  const scope = computers?.scope
  const ids = (computers?.computers ?? [])
    .filter((computer) => computer.status === 'connected')
    .map((computer) => computer.id)
    .sort((a, b) => Number(b === scope) - Number(a === scope))
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
 * One reading of the host: the headline figure, a bar with a hairline between its parts (Ramu's threads in the accent,
 * Ramu itself lighter, other apps neutral, the rest the empty track), and one legend line naming each part with its
 * unit. Parts at zero stay in the legend, dimmed, so the line keeps its shape between readings.
 */
function Meter({
  title,
  total,
  headline,
  detail,
  warning,
  parts,
}: {
  title: string
  total: number
  headline: string
  detail: string
  warning?: string
  parts: Part[]
}) {
  const shown = parts.filter((part) => part.key !== 'free' && part.value > 0)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-caption font-medium text-muted-foreground">{title}</span>
        {warning && (
          <span className="rounded-full bg-warn/15 px-1.5 text-caption font-medium text-warn">{warning}</span>
        )}
        <span className="ml-auto flex items-baseline gap-1.5 tabular-nums" role="status">
          <span className="text-control font-semibold text-foreground">{headline}</span>
          <span className="text-caption text-muted-foreground">{detail}</span>
        </span>
      </div>
      <div
        role="img"
        aria-label={[`${headline} ${detail}`, ...parts.map((part) => `${part.label} ${part.text}`)].join(', ')}
        className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-foreground/8"
      >
        {shown.map((part) => (
          <span
            key={part.key}
            className={cn(
              'h-full min-w-[3px] first:rounded-l-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
              part.className,
            )}
            style={{ width: percent(part.value, total) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 text-caption text-muted-foreground tabular-nums">
        {parts.map((part) => (
          <span key={part.key} className={cn('inline-flex items-center gap-1.5', part.value <= 0 && 'opacity-50')}>
            <span
              aria-hidden="true"
              className={cn(
                'size-2 flex-none rounded-full',
                part.key === 'free' ? 'border border-foreground/30' : part.className,
              )}
            />
            {part.label}
            <span className="text-soft">{part.text}</span>
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
  cores: number
}) {
  // `ps` reports 100 per busy core; the bar's whole is every core.
  const capacity = 100 * cores
  const allCpu = Math.max(hostCpu ?? 0, threadCpu + ramuCpu)
  const otherCpu = Math.max(0, allCpu - threadCpu - ramuCpu)
  const split = memory ? memoryBreakdown(memory, threadBytes, ramuBytes) : null
  const low = memory ? isLowMemory(memory) : false
  return (
    <div className="flex flex-col gap-4">
      {memory && split && (
        <Meter
          title={t('Memory')}
          total={memory.totalBytes}
          headline={memorySize(memory.totalBytes - memory.availableBytes)}
          detail={t('of {0}', { 0: memorySize(memory.totalBytes) })}
          warning={low ? t('Low memory') : undefined}
          parts={[
            {
              key: 'threads',
              label: t('Threads'),
              value: split.threads,
              text: memorySize(split.threads),
              className: 'bg-brand',
            },
            {
              key: 'ramu',
              label: t('Ramu'),
              value: split.ramu,
              text: memorySize(split.ramu),
              className: 'bg-brand/45',
            },
            {
              key: 'other',
              label: t('Other apps'),
              value: split.other,
              text: memorySize(split.other),
              className: low ? 'bg-warn/70' : 'bg-foreground/25',
            },
            { key: 'free', label: t('Available'), value: split.free, text: memorySize(split.free), className: '' },
          ]}
        />
      )}
      <Meter
        title={t('CPU')}
        total={capacity}
        headline={cpuPercent(allCpu, cores)}
        detail={cores === 1 ? t('of 1 core') : t('of {0} cores', { 0: cores })}
        parts={[
          {
            key: 'threads',
            label: t('Threads'),
            value: threadCpu,
            text: cpuPercent(threadCpu, cores),
            className: 'bg-brand',
          },
          { key: 'ramu', label: t('Ramu'), value: ramuCpu, text: cpuPercent(ramuCpu, cores), className: 'bg-brand/45' },
          {
            key: 'other',
            label: t('Other apps'),
            value: otherCpu,
            text: cpuPercent(otherCpu, cores),
            className: 'bg-foreground/25',
          },
          {
            key: 'free',
            label: t('Idle'),
            value: Math.max(0, capacity - allCpu),
            text: cpuPercent(Math.max(0, capacity - allCpu), cores),
            className: '',
          },
        ]}
      />
    </div>
  )
}

/** A thread's or Ramu's memory and CPU, on the same scale as the bars above. */
function Figures({ bytes, cpu, cores, busy }: { bytes: number; cpu: number; cores: number; busy?: boolean }) {
  return (
    <span className="flex flex-none flex-col items-end text-caption tabular-nums leading-tight">
      <span className="text-soft">{memorySize(bytes)}</span>
      <span className={busy ? 'text-warn' : 'text-muted-foreground'}>
        {t('{0} CPU', { 0: cpuPercent(cpu, cores) })}
      </span>
    </span>
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
    <div className="flex min-h-8 items-center gap-2 pl-3 text-caption text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="flex-none tabular-nums text-soft">{memorySize(item.rssBytes)}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="flex-none"
        aria-label={t('Stop {0}', { 0: name })}
        title={t('Stop {0}', { 0: name })}
        onClick={() => void anyHost(hostId, method, ...args).then(onStopped, (error) => notifyError(errorText(error)))}
      >
        <Square size={11} />
      </Button>
    </div>
  )
}

const ACTIVITY = {
  working: { text: 'Working', className: 'bg-brand/15 text-brand' },
  idle: { text: 'Idle', className: 'bg-foreground/8 text-muted-foreground' },
  'left-running': { text: 'Left running', className: 'bg-warn/15 text-warn' },
} as const

function ThreadRow({
  hostId,
  thread,
  task,
  servers,
  cores,
  onStopped,
}: {
  hostId: string
  thread: ThreadResources
  task?: Task
  servers: ThreadServer[]
  cores: number
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
  const [stopping, setStopping] = useState(false)
  const activity = threadActivity(task, thread)
  const busy = isBusy(thread)
  const stop = async () => {
    setConfirming(false)
    setStopping(true)
    try {
      for (const item of thread.items) {
        const [method, ...args] = stopItemCall(thread.taskId, item)
        await anyHost(hostId, method, ...args)
      }
      onStopped()
    } catch (error) {
      notifyError(errorText(error))
    } finally {
      setStopping(false)
    }
  }
  const title = task?.title ?? leftoverLabel(thread) ?? t('Untitled thread')
  const parts = thread.items.length + servers.length
  return (
    <li className="flex flex-col rounded-(--radius-s) border border-line bg-foreground/[0.02]">
      <div className="flex min-h-12 items-center gap-2.5 px-2.5 py-1.5">
        <RowButton
          className="min-w-0 flex-1 gap-2 p-0 hover:bg-transparent"
          aria-expanded={open}
          aria-label={t('Show what {0} uses', { 0: title })}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-control text-foreground" title={title}>
              {title}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
              <span className={cn('flex-none rounded-full px-1.5 font-medium', ACTIVITY[activity].className)}>
                {t(ACTIVITY[activity].text)}
              </span>
              {busy && <span className="flex-none text-warn">{t('Busy')}</span>}
              {servers.length > 0 && (
                <span className="truncate">
                  {servers.length === 1 ? t('1 server') : t('{0} servers', { 0: servers.length })}
                </span>
              )}
              {parts > 0 && (
                <ChevronDown
                  size={12}
                  aria-hidden="true"
                  className={cn('flex-none transition-transform motion-reduce:transition-none', !open && '-rotate-90')}
                />
              )}
            </span>
          </span>
        </RowButton>
        <Figures bytes={thread.rssBytes} cpu={thread.cpu} cores={cores} busy={busy} />
        {confirming ? (
          <Button
            size="xs"
            variant="destructive"
            className="flex-none"
            autoFocus
            onClick={() => void stop()}
            onBlur={() => setConfirming(false)}
          >
            {t('Stop?')}
          </Button>
        ) : (
          <Button
            size="xs"
            variant="outline"
            className="flex-none gap-1"
            disabled={stopping}
            title={t('Stop everything {0} left running', { 0: title })}
            onClick={() => (activity === 'working' ? setConfirming(true) : void stop())}
          >
            <Square size={10} aria-hidden="true" />
            {stopping ? t('Stopping…') : t('Stop')}
          </Button>
        )}
      </div>
      {open && parts > 0 && (
        <div className="flex flex-col border-t border-line px-2.5 py-1">
          {thread.items.map((item) => (
            <ItemRow key={item.id} hostId={hostId} thread={thread} item={item} onStopped={onStopped} />
          ))}
          {servers.length > 0 && (
            <ul className="my-0 flex list-none flex-col p-0">
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
      )}
    </li>
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
    return <p className="m-0 px-4 py-4 text-caption text-muted-foreground">{t('Reading resources…')}</p>
  return (
    <section className="flex flex-col divide-y divide-line" aria-label={t('Resources')}>
      {resources.snapshots.map(({ id, data, servers, refetch }, index) => {
        const ramuBytes = data.ramuBytes + (id === resources.current ? resources.appMemory : 0)
        const threadBytes = data.threads.reduce((sum, thread) => sum + thread.rssBytes, 0)
        const threadCpu = data.threads.reduce((sum, thread) => sum + thread.cpu, 0)
        const cores = Math.max(1, data.cores ?? 1)
        return (
          <div key={id} className="flex flex-col gap-4 px-4 py-3.5">
            {resources.snapshots.length > 1 && (
              <h3 className="m-0 text-control font-semibold text-foreground">{name(id)}</h3>
            )}
            <HostMeters
              memory={data.memory}
              threadBytes={threadBytes}
              ramuBytes={ramuBytes}
              threadCpu={threadCpu}
              ramuCpu={data.ramuCpu ?? 0}
              hostCpu={data.hostCpu}
              cores={cores}
            />
            <div className="flex flex-col gap-1.5">
              <h4 className="m-0 flex items-baseline gap-1.5 text-caption font-medium text-muted-foreground">
                {t('Running in threads')}
                {data.threads.length > 0 && <span className="tabular-nums">{data.threads.length}</span>}
              </h4>
              {data.threads.length ? (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {data.threads.map((thread) => (
                    <ThreadRow
                      key={thread.taskId}
                      hostId={id}
                      thread={thread}
                      cores={cores}
                      task={overviews[index]?.data?.tasks.find((task) => task.id === thread.taskId)}
                      servers={servers.filter((server) => server.taskId === thread.taskId)}
                      onStopped={refetch}
                    />
                  ))}
                </ul>
              ) : (
                <p className="m-0 rounded-(--radius-s) border border-dashed border-line px-2.5 py-2 text-caption text-muted-foreground">
                  {t('No thread is running anything')}
                </p>
              )}
              <div className="mt-1 flex min-h-10 items-center gap-2.5 px-2.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-control text-soft">{t('Ramu')}</span>
                  <span className="truncate text-caption text-muted-foreground">
                    {t('The service, the app and its browser')}
                  </span>
                </span>
                <Figures bytes={ramuBytes} cpu={data.ramuCpu ?? 0} cores={cores} />
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
