import { Message, MessageContent } from '@/components/ui/message'
import { Attachments } from '../../../composer/Attachments'
import { UserBubble } from './UserMessage'
import type { PendingSubmission as Submission } from '../lib/pendingSubmission'

/** Feedback for a send in flight; the authoritative transcript replaces it without a second copy. */
export function PendingSubmission({ submission }: { submission: Submission }) {
  return (
    <Message align="end" aria-busy="true" className="motion-safe:[animation:arrive_180ms_var(--ease)]">
      <MessageContent className="max-w-[78%] items-end">
        {submission.attachments.length > 0 && <Attachments files={submission.attachments} />}
        {submission.text && <UserBubble>{submission.text}</UserBubble>}
      </MessageContent>
    </Message>
  )
}
