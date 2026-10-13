import { expect, it } from 'vitest'
import { reviewGroups, reviewsByTurn } from '../src/reviewGroups'
import type { ChangeReview } from '../src/types'

const revision = (id: string, taskId: string, createdAt: number, changed = true): ChangeReview => ({
  id, taskId, sessionId: id, createdAt, state: 'ready', error: null, comments: [], aiState: 'idle', aiSummary: null,
  files: changed ? [{ id: 'file', repoId: 'general', repoName: 'Chat files', path: 'example.txt', status: 'modified', binary: false, oldContent: 'before', newContent: 'after' }] : [],
})
it('places change summaries on the final turn covered by each run without leaking to later or other chats', () => {
  const first = { ...revision('first', 'chat', 1), sessionId: 'session', startSeq: 0, endSeq: 5 }
  const second = { ...revision('second', 'chat', 2), sessionId: 'session', startSeq: 5, endSeq: 9 }
  const empty = { ...revision('empty', 'chat', 3, false), sessionId: 'session', startSeq: 9, endSeq: 12 }
  const turns = [{ key: 1, sequences: [1, 2] }, { key: 2, sequences: [3, 4, 5] }, { key: 3, sequences: [6, 7, 8] }, { key: 4, sequences: [10, 11, 12] }]
  expect([...reviewsByTurn([first, second, empty, revision('other-session', 'chat', 4)], 'session', turns)]).toEqual([[2, [first]], [3, [second]]])
})
it('groups revisions across sessions by chat, keeps latest first, and excludes no-change runs', () => {
  const old = revision('old', 'chat', 1), other = revision('other', 'another-chat', 2), latest = revision('latest', 'chat', 3)
  const reviews = [old, other, revision('empty', 'empty-chat', 4, false), latest]
  expect(reviewGroups(reviews)).toEqual([{ taskId: 'chat', revisions: [latest, old] }, { taskId: 'another-chat', revisions: [other] }])
  expect(reviews[0]).toBe(old)
})
