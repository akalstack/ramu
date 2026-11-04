import { useEffect, useRef } from 'react'
import { Clock, MoreHorizontal, RotateCcw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { notices } from '../chat/notificationCenter'
import { t, useLanguage } from '../i18n'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'
import { Menu } from '../Menu'
import { useComputers } from '../workspace/computers'
import { useHostSelection } from '../workspace/HostSelection'
import { deliverPendingThread, pendingThreads, usePendingThreads, type PendingThread } from './pendingThreads'

/**
 * Starts each thread waiting for its host as soon as that host is connected, one at a time per thread, and says so
 * with a way to open it. A host that drops mid-send leaves the thread waiting rather than failed.
 */
export function PendingThreadDelivery() {
  useLanguage()
  const computers = useComputers()
  const waiting = usePendingThreads()
  const { select } = useHostSelection()
  const running = useRef(new Set<string>())
  useEffect(() => {
    for (const item of waiting) {
      if (item.state !== 'waiting' || running.current.has(item.id)) continue
      const host = computers?.computers.find((computer) => computer.id === item.hostId)
      if (host?.status !== 'connected') continue
      running.current.add(item.id)
      pendingThreads().update(item.id, { state: 'sending', error: undefined })
      void deliverPendingThread(item, (method, ...args) =>
        (invokeOn as unknown as (host: string, method: string, ...args: unknown[]) => Promise<unknown>)(
          item.hostId,
          method,
          ...args,
        ),
      )
        .then(({ taskId, sessionId }) => {
          pendingThreads().remove(item.id)
          notices.add({
            id: `pending-thread:${item.id}`,
            type: 'success',
            title: t('Started “{0}”', { '0': item.title }),
            description: host.name,
            actionLabel: t('Open'),
            onAction: () => select(item.hostId, { kind: 'task', taskId, sessionId }),
          })
        })
        .catch((error) => {
          const now = computers?.computers.find((computer) => computer.id === item.hostId)
          pendingThreads().update(
            item.id,
            now?.status === 'connected' ? { state: 'failed', error: errorText(error) } : { state: 'waiting' },
          )
        })
        .finally(() => running.current.delete(item.id))
    }
  }, [waiting, computers, select])
  return null
}

/**
 * The threads started here while this host was away, at the top of its thread list: what each says, that it waits
 * for the host, and Retry, Move to another connected host or Remove.
 */
export function PendingThreadsSection({ hostId }: { hostId: string }) {
  useLanguage()
  const items = usePendingThreads(hostId)
  const computers = useComputers()
  if (!items.length) return null
  const others = (computers?.computers ?? []).filter(
    (computer) => computer.id !== hostId && computer.status === 'connected',
  )
  const hostName = computers?.computers.find((computer) => computer.id === hostId)?.name ?? ''
  return (
    <div className="flex flex-col gap-0.5 pb-2" aria-label={t('Waiting for host')}>
      {items.map((item) => (
        <PendingRow key={item.id} item={item} hostName={hostName} others={others} />
      ))}
    </div>
  )
}

function PendingRow({
  item,
  hostName,
  others,
}: {
  item: PendingThread
  hostName: string
  others: { id: string; name: string }[]
}) {
  const status =
    item.state === 'sending'
      ? t('Starting…')
      : item.state === 'failed'
        ? (item.error ?? t('Could not start'))
        : t('Waiting for {0}', { '0': hostName })
  return (
    <div className="group flex min-h-8 items-center gap-2 rounded-(--radius-s) px-2 py-1 text-control hover:bg-hover">
      <Clock size={14} className={item.state === 'failed' ? 'text-bad' : 'text-muted-foreground'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-foreground">{item.title}</span>
        <span className={`truncate text-caption ${item.state === 'failed' ? 'text-bad' : 'text-muted-foreground'}`}>
          {status}
        </span>
      </div>
      {item.state === 'failed' && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('Retry')}
          title={t('Retry')}
          onClick={() => pendingThreads().update(item.id, { state: 'waiting', error: undefined })}
        >
          <RotateCcw size={13} />
        </Button>
      )}
      <Menu
        label={t('Thread options')}
        icon={<MoreHorizontal size={14} />}
        align="end"
        disabled={item.state === 'sending'}
        items={[
          ...others.map((computer) => ({
            key: `move:${computer.id}`,
            label: t('Start on {0} instead', { '0': computer.name }),
            onSelect: () => pendingThreads().move(item.id, computer.id),
          })),
          { key: 'remove', label: t('Remove'), onSelect: () => pendingThreads().remove(item.id) },
        ]}
      />
    </div>
  )
}
