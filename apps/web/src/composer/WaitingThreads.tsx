import { useEffect, useRef } from 'react'
import { nextToSend } from '@ramu/shared/outbox'
import { Clock, MoreHorizontal, RotateCcw } from 'lucide-react'
import { AUTO_PROJECT } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { LocalInlineAction } from '@/components/inline-action'
import { RowButton } from '@/components/row-button'
import { Message, MessageContent } from '@/components/ui/message'
import { UserBubble } from '../chat/UserBubble'
import { notices } from '../chat/notificationCenter'
import { t, useLanguage } from '../i18n'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'
import { Menu } from '../Menu'
import { useComputers } from '../workspace/computers'
import { useHostSelection } from '../workspace/HostSelection'
import { outbox } from './outbox'
import { deliverPendingThread, pendingThreads, usePendingThreads, type PendingThread } from './pendingThreads'

/**
 * Delivers what this device holds for each host once it is connected. Threads waiting for a host start one at a time,
 * oldest first, each said so with a way to open it; one that failed waits for Retry without holding back the next. A
 * host that drops mid-send leaves the thread waiting rather than failed. Each host's message outbox is woken here
 * too, so messages written before a restart go out without their thread being opened.
 */
export function PendingThreadDelivery() {
  useLanguage()
  const computers = useComputers()
  const waiting = usePendingThreads()
  const { select } = useHostSelection()
  // A failure is judged against the connection as it is when the call ends, not when it began.
  const latestComputers = useRef(computers)
  latestComputers.current = computers
  useEffect(() => {
    for (const computer of computers?.computers ?? []) outbox(computer.id)
  }, [computers])
  useEffect(() => {
    for (const host of computers?.computers ?? []) {
      if (host.status !== 'connected') continue
      const item = nextToSend(
        waiting,
        (entry) => entry.hostId === host.id,
        (entry) => entry.state === 'failed',
      )
      if (!item) continue
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
          const now = latestComputers.current?.computers.find((computer) => computer.id === item.hostId)
          pendingThreads().update(
            item.id,
            now?.status === 'connected' ? { state: 'failed', error: errorText(error) } : { state: 'waiting' },
          )
        })
    }
  }, [waiting, computers, select])
  return null
}

/** What a waiting thread says about itself: starting, why it failed, or which host it waits for. */
function pendingStatus(item: PendingThread, hostName: string) {
  return item.state === 'sending'
    ? t('Starting…')
    : item.state === 'failed'
      ? (item.error ?? t('Could not start'))
      : t('Starts when {0} is back', { '0': hostName })
}

/**
 * The threads started here while this host was away, at the top of its thread list: what each says, that it waits
 * for the host, and Retry, Move to another connected host or Remove. A row opens New thread on its project, where its
 * first message shows and can be edited.
 */
export function PendingThreadsSection({ hostId }: { hostId: string }) {
  useLanguage()
  const items = usePendingThreads(hostId)
  const computers = useComputers()
  const { select } = useHostSelection()
  if (!items.length) return null
  const others = (computers?.computers ?? []).filter(
    (computer) => computer.id !== hostId && computer.status === 'connected',
  )
  const hostName = computers?.computers.find((computer) => computer.id === hostId)?.name ?? ''
  return (
    <div className="flex flex-col gap-0.5 pb-2" aria-label={t('Waiting for host')}>
      {items.map((item) => (
        <PendingRow
          key={item.id}
          item={item}
          hostName={hostName}
          others={others}
          onOpen={() => select(hostId, { kind: 'new', projectId: item.projectId ?? AUTO_PROJECT })}
        />
      ))}
    </div>
  )
}

function PendingRow({
  item,
  hostName,
  others,
  onOpen,
}: {
  item: PendingThread
  hostName: string
  others: { id: string; name: string }[]
  onOpen: () => void
}) {
  const failed = item.state === 'failed'
  return (
    <div className="group flex min-w-0 items-center gap-0.5">
      <RowButton size="sm" onClick={onOpen} title={item.prompt} className="flex-1">
        <Clock size={14} className={`flex-none ${failed ? 'text-bad' : 'text-muted-foreground'}`} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-foreground">{item.title}</span>
          <span className={`truncate text-caption ${failed ? 'text-bad' : 'text-muted-foreground'}`}>
            {pendingStatus(item, hostName)}
          </span>
        </span>
      </RowButton>
      {failed && <RetryButton id={item.id} />}
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

function RetryButton({ id }: { id: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={t('Retry')}
      title={t('Retry')}
      onClick={() => pendingThreads().update(id, { state: 'waiting', error: undefined })}
    >
      <RotateCcw size={13} />
    </Button>
  )
}

/**
 * New thread's view of the threads waiting for this host: each first message as it will open the thread, with what
 * it waits for and Edit (back into the message box), Remove and, after a failure, Retry.
 */
export function QueuedThreads({
  hostId,
  hostName,
  projectName,
  onEdit,
}: {
  hostId: string
  hostName: string
  /** The project a waiting thread will start in; null when it is chosen once the host is back. */
  projectName: (projectId: string | null) => string
  onEdit: (item: PendingThread) => void
}) {
  useLanguage()
  const items = usePendingThreads(hostId)
  if (!items.length) return null
  return (
    <section className="flex flex-col gap-3 px-1 pb-1" aria-label={t('Waiting for host')}>
      {items.map((item) => {
        const failed = item.state === 'failed'
        const sending = item.state === 'sending'
        return (
          <Message key={item.id} align="end" aria-busy={sending}>
            <MessageContent className="max-w-[78%] items-end gap-1">
              <div className={sending ? undefined : 'opacity-70'}>
                <UserBubble>
                  <span className="line-clamp-6 whitespace-pre-wrap break-words">{item.prompt || item.title}</span>
                </UserBubble>
              </div>
              <div
                role="status"
                className={`flex flex-wrap items-center justify-end gap-x-1.5 text-caption ${failed ? 'text-bad' : 'text-muted-foreground'}`}
              >
                <Clock size={12} className="flex-none" aria-hidden="true" />
                <span>
                  {t('New thread · {0}', { '0': projectName(item.projectId) })} · {pendingStatus(item, hostName)}
                </span>
                {!sending && (
                  <>
                    {failed && (
                      <LocalInlineAction
                        onClick={() => pendingThreads().update(item.id, { state: 'waiting', error: undefined })}
                      >
                        {t('Retry')}
                      </LocalInlineAction>
                    )}
                    <LocalInlineAction
                      onClick={() => {
                        const taken = pendingThreads().take(item.id)
                        if (taken) onEdit(taken)
                      }}
                    >
                      {t('Edit')}
                    </LocalInlineAction>
                    <LocalInlineAction tone="muted" onClick={() => pendingThreads().remove(item.id)}>
                      {t('Remove')}
                    </LocalInlineAction>
                  </>
                )}
              </div>
            </MessageContent>
          </Message>
        )
      })}
    </section>
  )
}
