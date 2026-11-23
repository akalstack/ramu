import { Clock } from 'lucide-react'
import { Message, MessageContent } from '@/components/ui/message'
import { LocalInlineAction } from '../../../components/inline-action'
import type { QueuedMessage } from '@ramu/shared/types'
import { Attachments } from '../../../composer/Attachments'
import { t as translate } from '../../../i18n'
import { visibleText } from '../lib/messages'
import { UserBubble } from './UserMessage'

/**
 * A new thread's first message while the host holds it: during an undo or other rewrite of its checkout, or, on a host
 * that runs one thread per checkout, while another thread works there. It reads as the opening message rather than
 * leaving the thread empty, with why it waits and a way to the thread it waits for. It joins the transcript once sent.
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
            <LocalInlineAction onClick={onOpenWaiting}>{translate('Open thread')}</LocalInlineAction>
          )}
        </div>
      </MessageContent>
    </Message>
  )
}
