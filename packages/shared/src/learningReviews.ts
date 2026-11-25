import type { LearningJob } from './types'

/** How many notes and skills one side of a review holds. */
export interface LearningCounts {
  notes: number
  newSkills: number
  updatedSkills: number
}

/**
 * What a learning review means to the person, for the line under the turn it learned from and for Inbox → Learned:
 * - `proposed`: nothing saved yet, waiting for Apply (Ask me first).
 * - `saved`: saved, with Undo.
 * - `undone`: taken back.
 */
export interface LearningLine {
  state: 'proposed' | 'saved' | 'undone'
  saved: LearningCounts
  waiting: LearningCounts
}

const EMPTY: LearningCounts = { notes: 0, newSkills: 0, updatedSkills: 0 }
const total = (counts: LearningCounts) => counts.notes + counts.newSkills + counts.updatedSkills

/** What a stored proposal would save; unreadable text counts as nothing. */
function proposed(text: string | null): LearningCounts {
  try {
    const value = JSON.parse(text ?? '') as { memories?: unknown[]; skills?: { id?: string }[]; archive?: unknown[] }
    const skills = Array.isArray(value.skills) ? value.skills : []
    return {
      notes: Array.isArray(value.memories) ? value.memories.length : 0,
      newSkills: skills.filter((skill) => !skill?.id).length,
      updatedSkills:
        skills.filter((skill) => skill?.id).length + (Array.isArray(value.archive) ? value.archive.length : 0),
    }
  } catch {
    return EMPTY
  }
}

/** The line for one review, or null when it has nothing to show (queued, running, failed, or a checkpoint only). */
export function learningLine(job: LearningJob): LearningLine | null {
  const changes = job.changes
  const saved: LearningCounts = changes
    ? {
        notes: changes.memories.length,
        newSkills: changes.skills.filter((skill) => skill.before === null).length,
        updatedSkills: changes.skills.filter((skill) => skill.before !== null).length,
      }
    : EMPTY
  if (job.status === 'undone') return total(saved) ? { state: 'undone', saved, waiting: EMPTY } : null
  if (job.status === 'pending') {
    const waiting = proposed(job.proposal)
    return total(waiting) ? { state: 'proposed', saved, waiting } : null
  }
  return job.status === 'applied' && total(saved) ? { state: 'saved', saved, waiting: EMPTY } : null
}

/** Reviews that wait for the person, newest first: what Inbox → Learned lists and counts. */
export function waitingReviews(jobs: LearningJob[]): LearningJob[] {
  return jobs
    .filter((job) => job.status === 'pending' && total(proposed(job.proposal)) > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** The review that learned from one turn: `seq` is the event that ended it. */
export function reviewForTurn(jobs: LearningJob[], sessionId: string, seq: number): LearningJob | undefined {
  return jobs.find((job) => job.sessionId === sessionId && job.seq === seq)
}
