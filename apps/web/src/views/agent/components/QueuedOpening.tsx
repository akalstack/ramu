import { Clock } from 'lucide-react'
import { Message, MessageContent } from '@/components/ui/message'
import { Button } from '@/components/desktop-button'
import type { QueuedMessage } from '@ramu/shared/types'
import { Attachments } from '../../../composer/Attachments'
import { t as translate } from '../../../i18n'
import { visibleText } from '../lib/messages'
import { UserBubble } from './UserMessage'

/**
 * A new thread's first message while the host holds it, because another thread is working in the same checkout. It
 * reads as the opening message rather than leaving the thread empty, with why it waits and a way to that thread, where
 * the person can answer what holds it up. It joins the transcript as a sent message once the other thread is done.
 */
export function QueuedOpening({
  message,
  waitingFor,
  onOpenWaiting,
}: {
  message: QueuedMessage
  /** The title of the thread it waits for; without one it is simply queued. */
  waitingFor: string | null
  onOpenWaiting?: () => void
}) {
  const text = visibleText(message.text)
  return (
    <Message align="end" aria-busy="true">
      <MessageContent className="max-w-[78%] items-end gap-1">
        {message.attachments?.length ? <Attachments files={message.attachments} /> : null}
        {text && <UserBubble>{text}</UserBubble>}
        <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Clock size={12} className="flex-none" />
          <span>
            {waitingFor
              ? translate('Waiting for “{0}” in the same checkout', { '0': waitingFor })
              : translate('Queued')}
          </span>
          {waitingFor && onOpenWaiting && (
            <Button variant="link" size="xs" className="h-auto p-0 text-caption" onClick={onOpenWaiting}>
              {translate('Open thread')}
            </Button>
          )}
        </div>
      </MessageContent>
    </Message>
  )
}
