import { CircleAlert } from 'lucide-react'
import { Message, MessageContent } from '@/components/ui/message'
import { Button } from '@/components/desktop-button'
import { t as translate } from '../../../i18n'
import { Attachments } from '../../../composer/Attachments'
import { UserBubble } from './UserMessage'
import type { PendingSubmission as Submission } from '../lib/pendingSubmission'
import { useSentRise } from '../../../chat/ChatMotion'

/**
 * A message shown the moment it is sent; the host's copy replaces it without a second one. A send that failed stays in
 * place, dimmed and marked, with Retry, Edit (back into the message box) and Remove.
 */
export function PendingSubmission({
  submission,
  onRetry,
  onEdit,
  onRemove,
}: {
  submission: Submission
  onRetry: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const rise = useSentRise<HTMLDivElement>(true)
  const failed = submission.state === 'failed'
  return (
    <Message align="end" aria-busy={!failed}>
      <MessageContent ref={rise} className="max-w-[78%] origin-bottom-right items-end">
        <div className={`flex flex-col items-end gap-2 ${failed ? 'opacity-60' : ''}`}>
          {submission.attachments.length > 0 && <Attachments files={submission.attachments} />}
          {submission.text && <UserBubble>{submission.text}</UserBubble>}
        </div>
        {failed && (
          <div
            className="flex flex-wrap items-center justify-end gap-1 text-control text-muted-foreground"
            role="alert"
          >
            <CircleAlert size={13} className="flex-none text-bad" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {submission.error ? translate('Not sent: {0}', { 0: submission.error }) : translate('Not sent')}
            </span>
            <Button variant="ghost" size="xs" onClick={onRetry}>
              {translate('Retry')}
            </Button>
            <Button variant="ghost" size="xs" onClick={onEdit}>
              {translate('Edit')}
            </Button>
            <Button variant="ghost" size="xs" onClick={onRemove}>
              {translate('Remove')}
            </Button>
          </div>
        )}
      </MessageContent>
    </Message>
  )
}
