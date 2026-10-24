import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inboxBlockerText } from '../src/runtime/inboxBlockerText.ts'

test('says what a waiting thread needs, with counts and the host reason, in both languages', () => {
  assert.equal(inboxBlockerText({ kind: 'approval', count: 1 }, 'en'), '1 approval needed')
  assert.equal(inboxBlockerText({ kind: 'approval', count: 3 }, 'en'), '3 approvals needed')
  assert.equal(inboxBlockerText({ kind: 'question', count: 2 }, 'id'), '2 pertanyaan untuk dijawab')
  assert.equal(inboxBlockerText({ kind: 'connector', count: 1 }, 'en'), 'Sign in to 1 connector')
  assert.equal(
    inboxBlockerText({ kind: 'goal-blocked', reason: 'Needs a test database' }, 'en'),
    'Goal blocked: Needs a test database',
  )
  assert.equal(inboxBlockerText({ kind: 'verification-failed' }, 'id'), 'Pemeriksaan tujuan gagal')
  assert.equal(inboxBlockerText({ kind: 'turn-limit' }, 'en'), 'Goal reached its turn limit')
  assert.equal(inboxBlockerText({ kind: 'goal-paused' }, 'id'), 'Tujuan dijeda')
})
