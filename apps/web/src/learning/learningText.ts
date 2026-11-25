import type { LearningCounts, LearningLine } from '@ramu/shared/learningReviews'
import { t } from '../i18n'

/** "2 notes · 1 new skill · 1 updated skill", leaving out what is zero. */
export function learningCountsText(counts: LearningCounts): string {
  return [
    counts.notes === 1 ? t('1 note') : counts.notes ? t('{0} notes', { '0': counts.notes }) : '',
    counts.newSkills === 1 ? t('1 new skill') : counts.newSkills ? t('{0} new skills', { '0': counts.newSkills }) : '',
    counts.updatedSkills === 1
      ? t('1 updated skill')
      : counts.updatedSkills
        ? t('{0} updated skills', { '0': counts.updatedSkills })
        : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The one line a review reads as, under its turn and in Inbox → Learned. */
export function learningLineText(line: LearningLine): string {
  switch (line.state) {
    case 'proposed':
      return t('Ramu can save {0}', { '0': learningCountsText(line.waiting) })
    case 'saved':
      return t('Learned {0}', { '0': learningCountsText(line.saved) })
    case 'undone':
      return `${t('Learned {0}', { '0': learningCountsText(line.saved) })} · ${t('Undone')}`
  }
}

/** What Undo left alone because the person or another thread changed it after the review saved it. */
export function undoKeptText(kept: number): string {
  return kept === 1
    ? t('1 item changed since it was saved, so it was kept.')
    : t('{0} items changed since they were saved, so they were kept.', { '0': kept })
}
