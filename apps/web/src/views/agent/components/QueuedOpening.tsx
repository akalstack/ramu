import { Clock } from 'lucide-react'
import { Message, MessageContent } from '@/components/ui/message'
import type { QueuedMessage } from '@ramu/shared/types'
import { Attachments } from '../../../composer/Attachments'
import { t as translate } from '../../../i18n'
import { visibleText } from '../lib/messages'
import { UserBubble } from './UserMessage'

/**
 * A new thread's first message while the host holds it, such as during an undo or other rewrite of its checkout. It
 * reads as the opening message rather than leaving the thread empty. It joins the transcript once sent.
 */
export function QueuedOpening({ message }: { message: QueuedMessage }) {
  const text = visibleText(message.text)
  return (
    <Message align="end" aria-busy="true">
      <MessageContent className="max-w-[78%] items-end gap-1">
        {message.attachments?.length ? <Attachments files={message.attachments} /> : null}
        {text && <UserBubble>{text}</UserBubble>}
        <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Clock size={12} className="flex-none" />
          <span>{translate('Queued')}</span>
        </div>
      </MessageContent>
    </Message>
  )
}
