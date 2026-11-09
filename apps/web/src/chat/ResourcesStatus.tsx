import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, MemoryStick, Square, X } from 'lucide-react'
import {
  gigabytes,
  isBusy,
  isLowMemory,
  stopItemCall,
  threadActivity,
  type ResourceItem,
  type ThreadResources,
} from '@ramu/shared/resources'
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
      return data ? [{ id, data, refetch: queries[index]!.refetch }] : []
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
  onStopped,
}: {
  hostId: string
  thread: ThreadResources
  task?: Task
  onStopped: () => void
}) {
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
      {open &&
        thread.items.map((item) => (
          <ItemRow key={item.id} hostId={hostId} thread={thread} item={item} onStopped={onStopped} />
        ))}
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
      {resources.snapshots.map(({ id, data, refetch }, index) => {
        const ramuBytes = data.ramuBytes + (id === resources.current ? resources.appMemory : 0)
        const used = data.memory ? data.memory.totalBytes - data.memory.availableBytes : null
        return (
          <div key={id} className="flex flex-col">
            <p className="m-0 text-caption text-muted-foreground" role="status">
              {[
                resources.snapshots.length > 1 ? name(id) : '',
                used !== null && data.memory
                  ? t('{0} of {1} GB used', { 0: gigabytes(used), 1: gigabytes(data.memory.totalBytes) })
                  : '',
                t('Ramu {0} GB', {
                  0: gigabytes(ramuBytes + data.threads.reduce((sum, thread) => sum + thread.rssBytes, 0)),
                }),
              ]
                .filter(Boolean)
                .join(' · ')}
              {data.memory && isLowMemory(data.memory) && <span className="text-warn"> · {t('Low memory')}</span>}
            </p>
            {data.threads.map((thread) => (
              <ThreadRow
                key={thread.taskId}
                hostId={id}
                thread={thread}
                task={overviews[index]?.data?.tasks.find((task) => task.id === thread.taskId)}
                onStopped={() => void refetch()}
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
