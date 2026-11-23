import { expect, it } from 'vitest'
import { nextToSend, nextToSendAcross } from '../src/outbox'

const item = (id: string, group: string, state?: string) => ({ id, group, state })

it('sends a group strictly in order: anything not finished in front holds the rest back', () => {
  const items = [item('a1', 'a', 'sending'), item('a2', 'a', 'waiting'), item('b1', 'b')]
  expect(nextToSend(items, (entry) => entry.group === 'a')).toBeUndefined()
  expect(nextToSend(items, (entry) => entry.group === 'b')?.id).toBe('b1')
  for (const state of ['failed', 'uncertain', 'review'])
    expect(nextToSend([item('a1', 'a', state), item('a2', 'a')], (entry) => entry.group === 'a')).toBeUndefined()
})

it('skips entries the caller counts as done', () => {
  const items = [item('a1', 'a', 'accepted'), item('a2', 'a', 'waiting')]
  expect(nextToSend(items, () => true)).toBeUndefined()
  expect(
    nextToSend(
      items,
      () => true,
      (entry) => entry.state === 'accepted',
    )?.id,
  ).toBe('a2')
})

it('picks the oldest sendable entry across groups without letting a held group be overtaken', () => {
  const items = [item('a1', 'a', 'failed'), item('a2', 'a'), item('b1', 'b'), item('b2', 'b')]
  const group = (entry: { group: string }) => entry.group
  expect(nextToSendAcross(items, group)?.id).toBe('b1')
  expect(nextToSendAcross(items.slice(0, 2), group)).toBeUndefined()
  // A failure that does not hold its group back (an independent new thread) lets the next one go.
  expect(nextToSendAcross(items, group, (entry) => entry.state === 'failed')?.id).toBe('a2')
})
