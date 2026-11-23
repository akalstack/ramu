import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCEPTED_HOLD_MS,
  deliveryBaseline,
  deliveryVisible,
  holdsQueue,
  reconcileDelivered,
} from '../src/runtime/transcript.ts'

const user = (text, id = 'event-1') => ({ kind: 'user', id, text, at: 1 })
const chat = (items = [], queue = []) => ({ id: 'thread', items, queue })
const outgoing = (history, state = 'accepted') => ({
  id: 'message',
  chatId: 'thread',
  text: 'Go',
  state,
  ...(state === 'accepted' ? { acceptedAt: Date.now() } : {}),
  deliveryBaseline: deliveryBaseline(history, 'Go'),
})

test('an acknowledgement retains the bubble until its host message is actually visible', () => {
  const before = chat()
  const item = outgoing(before)
  assert.deepEqual(reconcileDelivered([item], [before]), [item])
  const after = chat([user('Go')])
  assert.equal(deliveryVisible(item, after), true)
  assert.deepEqual(reconcileDelivered([item], [after]), [])
  assert.deepEqual(reconcileDelivered([item], []), [item])
})

test('stream-before-ack hides the duplicate without treating the mutation as settled', () => {
  const item = outgoing(chat(), 'sending')
  const after = chat([user('Go')])
  assert.equal(deliveryVisible(item, after), true)
  assert.deepEqual(reconcileDelivered([item], [after]), [item])
})

test('repeating the same message cannot acknowledge against its older occurrence or old queue entry', () => {
  const before = chat([user('Go')], [{ id: 'q1', text: 'Go' }])
  const item = outgoing(before)
  assert.equal(deliveryVisible(item, before), false)
  assert.equal(deliveryVisible(item, chat([...before.items, user('Go', 'event-2')], before.queue)), true)
  assert.equal(deliveryVisible(item, chat(before.items, [...before.queue, { id: 'q2', text: 'Go' }])), true)
})

test('persisted acknowledgements reconcile after restart without resending', () => {
  const saved = JSON.parse(JSON.stringify(outgoing(chat())))
  assert.deepEqual(reconcileDelivered([saved], [chat([user('Go')])]), [])
  assert.deepEqual(reconcileDelivered([saved], [chat()]), [saved])
})

test('uncertain delivery remains reviewable and host-added context does not block a confirmed queue handoff', () => {
  const item = outgoing(chat(), 'uncertain')
  assert.deepEqual(reconcileDelivered([item], [chat([user('Go')])]), [item])
  const accepted = { ...item, state: 'accepted' }
  assert.equal(
    deliveryVisible(accepted, chat([], [{ id: 'q', text: 'Go\n\n<ramu-context>files</ramu-context>' }])),
    true,
  )
})

test('an acknowledged message never holds its host’s queue for good', () => {
  const item = outgoing(chat())
  const later = item.acceptedAt + ACCEPTED_HOLD_MS + 1
  assert.equal(holdsQueue(item), true)
  assert.equal(holdsQueue(item, later), false)
  // Its history entry never appeared, or its thread left this phone: after the hold it is dropped.
  assert.deepEqual(reconcileDelivered([item], [chat()], later), [])
  assert.deepEqual(reconcileDelivered([item], [], later), [])
})
