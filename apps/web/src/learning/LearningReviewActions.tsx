import { useState } from 'react'
import type { LearningLine } from '@ramu/shared/learningReviews'
import type { LearningJob } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { notifyError } from '../chat/Notifications'
import { invokerFor } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { LearningDetailsDialog } from './LearningDetails'
import { refreshLearning } from './learningQueries'

/**
 * What a person can do with one review, wherever it shows: Apply or Dismiss what waits, Undo what was saved, and read
 * the details. Every call goes to the host the review belongs to.
 */
export function LearningReviewActions({
  host,
  job,
  line,
  readOnly = false,
  className,
  onUndone,
}: {
  host: string
  job: LearningJob
  line: LearningLine
  /** A viewer device or a read-only transcript: the details stay readable, nothing changes. */
  readOnly?: boolean
  className?: string
  /** How many saved items Undo left alone because they changed since. */
  onUndone?: (kept: number) => void
}) {
  useLanguage()
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(false)
  const invoke = invokerFor(host)
  const run = (work: () => Promise<unknown>) => {
    setBusy(true)
    void work()
      .then(
        () => refreshLearning(host),
        (error) => notifyError(errorText(error), 'Learning'),
      )
      .finally(() => setBusy(false))
  }
  const waiting = line.state === 'proposed'
  const undoable = line.state === 'saved'
  const disabled = readOnly || busy
  return (
    <>
      {waiting && (
        <Button
          size="xs"
          variant="secondary"
          className={className}
          disabled={disabled}
          onClick={() => run(() => invoke('learning.apply', job.id))}
        >
          {t('Apply')}
        </Button>
      )}
      {waiting && (
        <Button
          size="xs"
          variant="ghost"
          className={className}
          disabled={disabled}
          onClick={() => run(() => invoke('learning.dismiss', job.id))}
        >
          {t('Dismiss')}
        </Button>
      )}
      {undoable && (
        <Button
          size="xs"
          variant="ghost"
          className={className}
          disabled={disabled}
          onClick={() =>
            run(async () => {
              const { kept } = await invoke('learning.undo', job.id)
              onUndone?.(kept)
            })
          }
        >
          {t('Undo')}
        </Button>
      )}
      <Button size="xs" variant="ghost" className={className} aria-haspopup="dialog" onClick={() => setDetails(true)}>
        {t('Details')}
      </Button>
      {details && <LearningDetailsDialog host={host} job={job} onClose={() => setDetails(false)} />}
    </>
  )
}
