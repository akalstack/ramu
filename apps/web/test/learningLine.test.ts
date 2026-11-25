import { expect, it, vi } from 'vitest'
import { translate } from '@ramu/shared/i18n'
import { learningLine } from '@ramu/shared/learningReviews'
import type { LearningJob } from '@ramu/shared/types'

vi.mock('../src/i18n', () => ({
  t: (source: string, values?: Record<string, string | number>) => translate('en', source, values),
}))
const { learningLineText, undoKeptText } = await import('../src/learning/learningText')

const job = (over: Partial<LearningJob>): LearningJob => ({
  id: 'j',
  sessionId: 's',
  projectId: null,
  seq: 4,
  status: 'pending',
  createdAt: 1,
  error: null,
  proposal: null,
  ...over,
})
const proposal = (memories: number, skills: { id?: string }[]) =>
  JSON.stringify({ memories: Array.from({ length: memories }, () => ({})), skills, archive: [] })
const changes = (notes: number, skills: (number | null)[]): LearningJob['changes'] => ({
  memories: Array.from({ length: notes }, (_, i) => ({ id: `m${i}`, title: 'Note', action: 'added', updatedAt: 1 })),
  skills: skills.map((before, i) => ({ id: `k${i}`, name: 'skill', before, after: 2 })),
})
const text = (value: LearningJob) => learningLineText(learningLine(value)!)

it('says what a review would save before Apply, counting one and many apart', () => {
  expect(text(job({ proposal: proposal(2, [{}]) }))).toBe('Ramu can save 2 notes · 1 new skill')
  expect(text(job({ proposal: proposal(1, [{ id: 'a' }, { id: 'b' }]) }))).toBe(
    'Ramu can save 1 note · 2 updated skills',
  )
})

it('says what was saved, and when it was taken back', () => {
  expect(text(job({ status: 'applied', changes: changes(2, [1, null]) }))).toBe(
    'Learned 2 notes · 1 new skill · 1 updated skill',
  )
  expect(text(job({ status: 'undone', changes: changes(0, [null, null]) }))).toBe('Learned 2 new skills · Undone')
})

it('says how many items Undo kept because they changed since', () => {
  expect(undoKeptText(1)).toBe('1 item changed since it was saved, so it was kept.')
  expect(undoKeptText(3)).toBe('3 items changed since they were saved, so they were kept.')
})
