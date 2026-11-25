import type { LearningJob } from '@ramu/shared/types'
import type { TranslationValues } from '@ramu/shared/i18n'
import { learningLine, type LearningCounts, type LearningLine } from '@ramu/shared/learningReviews'
import type { TranscriptItem } from './types'

type Say = (text: string, values?: TranslationValues) => string

/** "2 notes · 1 new skill · 1 updated skill", leaving out what is zero. */
export function learningCounts(counts: LearningCounts, say: Say): string {
  return [
    counts.notes === 1 ? say('1 note') : counts.notes ? say('{0} notes', { 0: counts.notes }) : '',
    counts.newSkills === 1
      ? say('1 new skill')
      : counts.newSkills
        ? say('{0} new skills', { 0: counts.newSkills })
        : '',
    counts.updatedSkills === 1
      ? say('1 updated skill')
      : counts.updatedSkills
        ? say('{0} updated skills', { 0: counts.updatedSkills })
        : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The one line a thread shows under the turn a review learned from. */
export function learningLineText(line: LearningLine, say: Say): string {
  switch (line.state) {
    case 'saved':
      return say('Learned {0}', { 0: learningCounts(line.saved, say) })
    case 'proposed':
      return say('Ramu can save {0}', { 0: learningCounts(line.waiting, say) })
    case 'undone':
      return say('Learning undone')
  }
}

/** What Undo reports: how many saved items it left alone because they changed after the review saved them. */
export function undoneText(kept: number, say: Say): string {
  if (!kept) return say('Undone')
  return kept === 1
    ? say('Undone. 1 item changed since, so it was kept.')
    : say('Undone. {0} items changed since, so they were kept.', { 0: kept })
}

/**
 * Places each review of this session under the turn it learned from: just before the first message sent after the
 * turn's result event (`job.seq`), or at the end of the transcript. Reviews with nothing to show are left out.
 */
export function withLearningLines(
  items: TranscriptItem[],
  jobs: readonly LearningJob[],
  sessionId: string | null | undefined,
): TranscriptItem[] {
  const lines = jobs
    .filter((job) => job.sessionId === sessionId)
    .flatMap((job) => {
      const line = learningLine(job)
      return line ? [{ job, line }] : []
    })
    .sort((a, b) => a.job.seq - b.job.seq)
  if (!lines.length) return items
  const out = [...items]
  for (const { job, line } of lines.reverse()) {
    const next = out.findIndex((item) => item.kind === 'user' && item.seq !== undefined && item.seq > job.seq)
    out.splice(next < 0 ? out.length : next, 0, { kind: 'learning', id: `learning-${job.id}`, jobId: job.id, line })
  }
  return out
}
