import { Message, MessageContent } from '@/components/ui/message'
import { Attachments } from '../../../composer/Attachments'
import { UserBubble } from './UserMessage'
import type { PendingSubmission as Submission } from '../lib/pendingSubmission'
import { useSentRise } from '../../../chat/ChatMotion'

/** Feedback for a send in flight; the authoritative transcript replaces it without a second copy. */
export function PendingSubmission({ submission }: { submission: Submission }) {
  const rise = useSentRise<HTMLDivElement>(true)
  return (
    <Message align="end" aria-busy="true">
      <MessageContent ref={rise} className="max-w-[78%] origin-bottom-right items-end">
        {submission.attachments.length > 0 && <Attachments files={submission.attachments} />}
        {submission.text && <UserBubble>{submission.text}</UserBubble>}
      </MessageContent>
    </Message>
  )
}
