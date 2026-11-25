import { describe, expect, it } from 'vitest'
import type { LearningJob } from '../src/types'
import { learningLine, reviewForTurn, waitingReviews } from '../src/learningReviews'

const job = (over: Partial<LearningJob>): LearningJob => ({
  id: 'j',
  sessionId: 's',
  projectId: null,
  seq: 5,
  status: 'pending',
  createdAt: 1,
  error: null,
  proposal: null,
  ...over,
})
const proposal = JSON.stringify({
  checkpoint: 'x',
  memories: [{}, {}],
  skills: [{ name: 'new' }, { id: 'k', name: 'old' }],
  archive: [],
})
const changes = {
  memories: [{ id: 'm', title: 'Note', action: 'added' as const, updatedAt: 2 }],
  skills: [{ id: 'k', name: 'old', before: 1, after: 2 }],
}

describe('learningLine', () => {
  it('reads a proposal waiting for Apply', () => {
    expect(learningLine(job({ proposal }))).toEqual({
      state: 'proposed',
      saved: { notes: 0, newSkills: 0, updatedSkills: 0 },
      waiting: { notes: 2, newSkills: 1, updatedSkills: 1 },
    })
  })
  it('reads what was saved, and what was taken back', () => {
    expect(learningLine(job({ status: 'applied', changes }))).toMatchObject({
      state: 'saved',
      saved: { notes: 1, newSkills: 0, updatedSkills: 1 },
    })
    expect(learningLine(job({ status: 'undone', changes }))?.state).toBe('undone')
  })
  it('shows nothing for a checkpoint-only review or one that is not finished', () => {
    const checkpointOnly = JSON.stringify({ checkpoint: 'x', memories: [], skills: [], archive: [] })
    expect(learningLine(job({ proposal: checkpointOnly }))).toBeNull()
    expect(learningLine(job({ status: 'applied' }))).toBeNull()
    expect(learningLine(job({ status: 'queued' }))).toBeNull()
    expect(learningLine(job({ status: 'failed' }))).toBeNull()
    expect(learningLine(job({ proposal: 'not json' }))).toBeNull()
  })
})

it('lists reviews waiting for the person, newest first, and finds the one for a turn', () => {
  const jobs = [
    job({ id: 'a', proposal, createdAt: 1 }),
    job({ id: 'b', proposal, createdAt: 3, seq: 9 }),
    job({ id: 'c', status: 'applied', changes }),
  ]
  expect(waitingReviews(jobs).map((entry) => entry.id)).toEqual(['b', 'a'])
  expect(reviewForTurn(jobs, 's', 9)?.id).toBe('b')
  expect(reviewForTurn(jobs, 'other', 9)).toBeUndefined()
})
