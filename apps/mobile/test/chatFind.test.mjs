import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findInRows } from '../src/runtime/chatFind.ts'

const rows = [
  { kind: 'user', id: 'u', text: 'Deploy the bakery site' },
  {
    kind: 'summary',
    id: 's',
    label: 'Worked for 2m',
    items: [
      { kind: 'thinking', id: 't', text: 'Check the deploy logs first' },
      { kind: 'tool', id: 'x', tool: 'execute', verb: 'Bash', subject: 'vercel deploy --prod', status: 'completed' },
    ],
  },
  { kind: 'text', id: 'a', text: 'Deployed. The DEPLOY is live.' },
  { kind: 'pending', id: 'p', outbox: {} },
]

test('find counts every match in order, including steps folded under Worked for', () => {
  assert.deepEqual(
    findInRows(rows, 'deploy').map((match) => match.id),
    ['u', 's', 's', 'a', 'a'],
  )
  assert.deepEqual(
    findInRows(rows, ' DEPLOY ').map((match) => match.index),
    [0, 1, 1, 2, 2],
  )
})

test('an empty query or a missing word finds nothing', () => {
  assert.deepEqual(findInRows(rows, '   '), [])
  assert.deepEqual(findInRows(rows, 'croissant'), [])
})
