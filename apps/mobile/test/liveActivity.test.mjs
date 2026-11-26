import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liveActivityStep, liveActivityThreads, liveThreadStatus } from '../src/runtime/liveActivity.ts'

const chat = (id, status, extra = {}) => ({
  id,
  sessionId: `s-${id}`,
  title: `Thread ${id}`,
  status,
  items: [],
  goal: null,
  lastActiveAt: 1,
  ...extra,
})

test('a waiting thread is named by what it needs from the person', () => {
  assert.equal(liveThreadStatus(chat('a', 'needs-input', { items: [{ kind: 'permission', id: 'p' }] })), 'approval')
  assert.equal(liveThreadStatus(chat('a', 'needs-input', { items: [{ kind: 'question', id: 'q' }] })), 'question')
  // An answered request no longer counts, and a host's summary covers requests older than the transcript the phone holds.
  assert.equal(
    liveThreadStatus(chat('a', 'needs-input', { items: [{ kind: 'permission', id: 'p', decision: 'allow' }] })),
    'input',
  )
  assert.equal(
    liveThreadStatus(
      chat('a', 'needs-input', { inputSummary: { count: 1, approvals: 1, connectors: 0, requests: [] } }),
    ),
    'approval',
  )
  assert.equal(liveThreadStatus(chat('a', 'running', { waitingUntil: Date.now() + 60_000 })), 'limit')
  assert.equal(
    liveThreadStatus(chat('a', 'needs-input', { goal: { status: 'paused', pausedBy: 'provider-limit' } })),
    'limit',
  )
  assert.equal(liveThreadStatus(chat('a', 'running')), 'working')
  assert.equal(liveThreadStatus(chat('a', 'failed')), 'failed')
  assert.equal(liveThreadStatus(chat('a', 'ready-for-review')), 'done')
  assert.equal(liveThreadStatus(chat('a', 'archived')), null)
})

test('the stretch keeps threads it followed after they finish, and never reports older finished work', () => {
  const chats = [
    chat('old', 'idle', { lastActiveAt: 5 }),
    chat('was-running', 'ready-for-review', { lastActiveAt: 4 }),
    chat('broke', 'failed', { lastActiveAt: 3 }),
    chat('runs', 'running', { lastActiveAt: 2 }),
    chat('gone', 'archived', { lastActiveAt: 6 }),
  ]
  const threads = liveActivityThreads(chats, new Set(['was-running', 'broke', 'gone']))
  assert.deepEqual(
    threads.map((t) => [t.id, t.status]),
    [
      ['was-running', 'done'],
      ['broke', 'failed'],
      ['runs', 'working'],
    ],
  )
})

test('the activity starts with work, stays while anything runs or waits, and finishes or steps aside after', () => {
  const step = (input) =>
    liveActivityStep({
      active: false,
      ongoing: 0,
      followed: 0,
      online: true,
      foreground: true,
      viewingFinished: false,
      ...input,
    })
  assert.equal(step({ ongoing: 1 }), 'start')
  // Ramu closed: the host starts it through push-to-start instead.
  assert.equal(step({ ongoing: 1, foreground: false }), 'none')
  assert.equal(step({ active: true, ongoing: 1, followed: 1 }), 'update')
  assert.equal(step({ active: true, ongoing: 0, followed: 2 }), 'finish')
  // The person is already looking at the thread that finished.
  assert.equal(step({ active: true, ongoing: 0, followed: 2, viewingFinished: true }), 'dismiss')
  // Left from an earlier run of Ramu, with that work already over.
  assert.equal(step({ active: true, ongoing: 0, followed: 0 }), 'dismiss')
  // With the host out of reach nothing is known, so the last real state stays until it goes stale.
  assert.equal(step({ active: true, ongoing: 0, followed: 2, online: false }), 'none')
  assert.equal(step({ ongoing: 0 }), 'none')
})
