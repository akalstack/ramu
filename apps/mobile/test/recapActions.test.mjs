import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SNOOZE_MENU, actOnHost, applyRecapAction, snoozeEnds, RECAP_TOAST } from '../src/runtime/recapActions.ts'
import { currentToast, dismissToast, showToast, subscribeToast } from '../src/runtime/toast.ts'

const item = (id, status = 'open') => ({ id, key: id, status, snoozedUntil: null, title: id })

test('the snooze menu has the same three choices as the desktop, each ending in the future', () => {
  assert.deepEqual(
    SNOOZE_MENU.map((entry) => entry.choice),
    ['in-3-hours', 'tomorrow', 'next-week'],
  )
  const now = Date.parse('2026-10-18T08:00:00')
  assert.equal(snoozeEnds('in-3-hours', now), now + 3 * 3_600_000)
  for (const { choice } of SNOOZE_MENU) assert.ok(snoozeEnds(choice, now) > now)
})

test('an action changes only its item, and a snooze carries the chosen time or a day', () => {
  const now = 1_000_000
  const items = [item('a'), item('b')]
  const snoozed = applyRecapAction(items, 'a', 'snoozed', now + 5000, now)
  assert.deepEqual([snoozed[0].status, snoozed[0].snoozedUntil], ['snoozed', now + 5000])
  assert.equal(snoozed[1], items[1])
  assert.equal(applyRecapAction(items, 'a', 'snoozed', undefined, now)[0].snoozedUntil, now + 86_400_000)
  assert.deepEqual(
    [
      applyRecapAction(items, 'a', 'done', undefined, now)[0].status,
      applyRecapAction(items, 'a', 'done', undefined, now)[0].snoozedUntil,
    ],
    ['done', null],
  )
})

test('undo puts the item back to open and clears its snooze', () => {
  const back = applyRecapAction([item('a', 'snoozed')], 'a', 'open', undefined, 1)
  assert.deepEqual([back[0].status, back[0].snoozedUntil], ['open', null])
})

test('every action but undo has a toast message', () => {
  assert.deepEqual(Object.keys(RECAP_TOAST).sort(), ['dismissed', 'done', 'snoozed'])
})

test('a chosen snooze time is sent as the third argument, other actions as two', async () => {
  const calls = []
  const call = async (...args) => void calls.push(args)
  assert.deepEqual(await actOnHost(call, 'a', 'snoozed', 99), { exactTime: true })
  await actOnHost(call, 'a', 'done')
  await actOnHost(call, 'a', 'open')
  await actOnHost(call, 'a', 'snoozed')
  assert.deepEqual(calls, [
    ['a', 'snoozed', 99],
    ['a', 'done'],
    ['a', 'open'],
    ['a', 'snoozed'],
  ])
})

test('an older host that refuses the time still snoozes, for its default day, and the outcome says so', async () => {
  const calls = []
  const call = async (...args) => {
    calls.push(args)
    if (args.length === 3) throw new Error('Invalid arguments: too big')
  }
  assert.deepEqual(await actOnHost(call, 'a', 'snoozed', 99), { exactTime: false })
  assert.deepEqual(calls, [
    ['a', 'snoozed', 99],
    ['a', 'snoozed'],
  ])
})

test('a host that is really unreachable fails the action instead of pretending', async () => {
  await assert.rejects(
    actOnHost(
      async () => {
        throw new Error('offline')
      },
      'a',
      'snoozed',
      99,
    ),
    /offline/,
  )
})

test('the toast replaces the previous one, can be dismissed by id, and tells listeners', () => {
  let heard = 0
  const off = subscribeToast(() => heard++)
  showToast('recapDone', { label: 'undo', run: () => {} })
  const first = currentToast()
  assert.equal(first.message, 'recapDone')
  showToast('recapDismissed')
  assert.equal(currentToast().message, 'recapDismissed')
  dismissToast(first.id) // a stale timer for the first toast must not close the second
  assert.equal(currentToast().message, 'recapDismissed')
  dismissToast()
  assert.equal(currentToast(), null)
  assert.equal(heard, 3)
  off()
})
