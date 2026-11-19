import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changesItem, withChangeCards } from '../src/runtime/changeCards.ts'

const file = (id, path, oldContent, newContent, extra = {}) => ({
  id,
  repoId: 'r',
  repoName: 'repo',
  path,
  status: 'modified',
  binary: false,
  oldContent,
  newContent,
  ...extra,
})
const review = (id, endSeq, files, extra = {}) => ({
  id,
  taskId: 't',
  sessionId: 's',
  createdAt: 0,
  state: 'ready',
  error: null,
  files,
  comments: [],
  aiState: 'idle',
  aiSummary: null,
  startSeq: endSeq - 5,
  endSeq,
  ...extra,
})

test('a review card totals each file, counting lines from snapshots when the host sent none', () => {
  const card = changesItem(
    review('a', 10, [
      file('f1', 'src/a.ts', 'x\ny', 'x\nz\nw'),
      file('f2', 'b.md', '', '', { addedLines: 4, removedLines: 1 }),
      file('f3', 'logo.png', '', '', { binary: true }),
    ]),
  )
  assert.deepEqual(card.files, [
    { id: 'f1', path: 'src/a.ts', additions: 2, deletions: 1, binary: false },
    { id: 'f2', path: 'b.md', additions: 4, deletions: 1, binary: false },
    { id: 'f3', path: 'logo.png', additions: 0, deletions: 0, binary: true },
  ])
  assert.equal(card.additions, 6)
  assert.equal(card.deletions, 2)
  assert.equal(card.undone, false)
})

test('cards end the turn they recorded and skip other sessions, unfinished and empty reviews', () => {
  const items = [
    { kind: 'user', id: 'u1', text: 'one', at: 0, seq: 1 },
    { kind: 'text', id: 't1', text: 'done' },
    { kind: 'user', id: 'u2', text: 'two', at: 0, seq: 20 },
    { kind: 'text', id: 't2', text: 'done' },
  ]
  const placed = withChangeCards(
    items,
    [
      review('late', 30, [file('x', 'x.ts', 'a', 'b')]),
      review('early', 10, [file('y', 'y.ts', 'a', 'b')]),
      review('other', 10, [file('z', 'z.ts', 'a', 'b')], { sessionId: 'elsewhere' }),
      review('recording', 10, [file('w', 'w.ts', 'a', 'b')], { state: 'recording' }),
      review('empty', 10, []),
    ],
    's',
  )
  assert.deepEqual(
    placed.map((item) => item.id),
    ['u1', 't1', 'changes-early', 'u2', 't2', 'changes-late'],
  )
  assert.equal(withChangeCards(items, [], 's'), items)
})
