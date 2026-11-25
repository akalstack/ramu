import { Sparkles } from 'lucide-react'
import type { InboxReview } from '@ramu/shared/hostInbox'
import { learningLine } from '@ramu/shared/learningReviews'
import { useViewOnly } from '../composer/useViewOnly'
import { FeedSection } from '../HomeSection'
import { t, useLanguage } from '../i18n'
import { LearningReviewActions } from '../learning/LearningReviewActions'
import { learningLineText } from '../learning/learningText'
import { HostProvider } from '../workspace/HostProvider'
import { useHostSelection } from '../workspace/HostSelection'
import { InboxList, InboxMark, InboxRow } from './InboxParts'

/**
 * Reviews waiting for the person, above what Ramu learned: the thread each came from, what it would save, and Apply,
 * Dismiss and Details beside it. The row opens the thread at the turn it learned from.
 */
export function LearningReviewList({
  reviews,
  taskOf,
  where,
  available = () => true,
}: {
  reviews: InboxReview[]
  /** The thread a review's session belongs to, when the host's activity names it. */
  taskOf: (computerId: string, sessionId: string) => string | undefined
  /** Which host it is on, when there are several. */
  where?: (computerId: string) => string
  available?: (computerId: string) => boolean
}) {
  useLanguage()
  if (!reviews.length) return null
  return (
    <FeedSection title={t('Waiting for you')} count={reviews.length}>
      <InboxList>
        {reviews.map((review) => (
          <HostProvider key={JSON.stringify([review.computerId, review.job.id])} hostId={review.computerId}>
            <ReviewRow
              review={review}
              taskId={taskOf(review.computerId, review.job.sessionId)}
              where={where?.(review.computerId)}
              online={available(review.computerId)}
            />
          </HostProvider>
        ))}
      </InboxList>
    </FeedSection>
  )
}

function ReviewRow({
  review: { computerId, job },
  taskId,
  where,
  online,
}: {
  review: InboxReview
  taskId: string | undefined
  where: string | undefined
  online: boolean
}) {
  const viewOnly = useViewOnly()
  const { select } = useHostSelection()
  const line = learningLine(job)
  if (!line) return null
  return (
    <InboxRow
      mark={
        <InboxMark tone="warn">
          <Sparkles />
        </InboxMark>
      }
      title={job.sessionTitle ?? t('Thread')}
      meta={[learningLineText(line), where].filter(Boolean).join(' · ')}
      at={job.createdAt}
      disabled={!online || !taskId}
      onOpen={() =>
        taskId && select(computerId, { kind: 'task', taskId, sessionId: job.sessionId, sourceSeq: job.seq })
      }
      actions={<LearningReviewActions host={computerId} job={job} line={line} readOnly={viewOnly || !online} />}
    />
  )
}
