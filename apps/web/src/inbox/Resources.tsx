import { useState, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Square } from 'lucide-react'
import {
  gigabytes,
  isBusy,
  isLowMemory,
  stopItemCall,
  threadActivity,
  type ResourceItem,
  type ResourceSnapshot,
  type ThreadResources,
} from '@ramu/shared/resources'
import type { Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'
import { invokeOn, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { useComputers } from '../workspace/computers'
import { useHostOverviews } from '../workspace/hostOverview'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
const anyHost = invokeOn as unknown as Invoke

const POLL_MS = 5000

/** Figures for every connected owner host, read only while this hook is mounted, so a closed Running tab runs no `ps`. */
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

/** Threads this panel already lists, so the Running list below it does not repeat them. */
const listedThreads = (snapshots: { id: string; data: ResourceSnapshot }[]) =>
  new Set(snapshots.flatMap(({ id, data }) => data.threads.map((thread) => JSON.stringify([id, thread.taskId]))))

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
function ResourcesPanel({ resources }: { resources: ReturnType<typeof useResources> }) {
  useLanguage()
  const computers = useComputers()
  const overviews = useHostOverviews(resources.snapshots.map((entry) => entry.id))
  const name = (id: string) => computers?.computers.find((computer) => computer.id === id)?.name ?? ''
  if (!resources.snapshots.length) return null
  return (
    <section className="flex flex-col gap-3" aria-label={t('Resources')}>
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

/** The Running tab: figures above whatever running work they do not already list. */
export function RunningTab({ children }: { children: (listed: Set<string>) => ReactNode }) {
  const resources = useResources()
  return (
    <>
      <ResourcesPanel resources={resources} />
      {children(listedThreads(resources.snapshots))}
    </>
  )
}
