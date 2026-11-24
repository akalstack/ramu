import { expect, it } from 'vitest'
import type { AgentEvent, Attachment, QueuedMessage } from '@ramu/shared/types'
import { splitSteering, unechoedSubmissions, type PendingSubmission } from '../src/views/agent/lib/pendingSubmission'
const pending: PendingSubmission = {
  id: 'a',
  text: 'Hello',
  attachments: [],
  afterEvent: 1,
  queuedIds: ['older'],
  sentAt: 1,
  state: 'sending',
  payload: { outgoing: 'Hello', mode: 'queue', context: [], compactFirst: false, reviews: [] },
}
const old: AgentEvent = { kind: 'user', text: 'Hello' }
const visible = (item: PendingSubmission, events: AgentEvent[], queue: QueuedMessage[] = []) =>
  unechoedSubmissions([item], events, queue).length === 1
it('shows a send before the host replies without confusing an older identical message for it', () => {
  expect(visible(pending, [old])).toBe(true)
})
it('replaces a send with the host echo, including attached file context', () => {
  expect(visible(pending, [old, { kind: 'user', text: 'Hello\n\n<ramu-context>\nFiles' }])).toBe(false)
})
it('keeps a send for unrelated messages and sub-agent output', () => {
  expect(
    visible(pending, [
      old,
      { kind: 'user', text: 'Hello', agentId: 'helper' },
      { kind: 'user', text: 'Other message' },
    ]),
  ).toBe(true)
})
it('replaces a send with a newly accepted durable queue entry', () => {
  const queued: QueuedMessage = { id: 'older', text: 'Hello', mode: 'queue' }
  expect(visible(pending, [old], [queued])).toBe(true)
  expect(visible(pending, [old], [{ ...queued, id: 'new' }])).toBe(false)
})
it('matches attachment-only messages by their exact attachment identities', () => {
  const attachments = [{ id: 'image' }] as Attachment[]
  const sent = { ...pending, text: '', attachments }
  expect(visible(sent, [old, { kind: 'user', text: '', attachments }])).toBe(false)
  expect(visible(sent, [old, { kind: 'user', text: '', attachments: [{ id: 'different' }] as Attachment[] }])).toBe(
    true,
  )
})
it('lets each echo stand for one send, so two identical messages each wait for their own copy', () => {
  const second = { ...pending, id: 'b' }
  const echo: AgentEvent = { kind: 'user', text: 'Hello' }
  expect(unechoedSubmissions([pending, second], [old, echo], []).map((item) => item.id)).toEqual(['b'])
  expect(unechoedSubmissions([pending, second], [old, echo, echo], [])).toEqual([])
})
it('keeps a failed send on screen until the host shows it got it after all', () => {
  const failed = { ...pending, state: 'failed' as const, error: 'Timed out' }
  expect(visible(failed, [old])).toBe(true)
  expect(visible(failed, [old, { kind: 'user', text: 'Hello' }])).toBe(false)
})
it('keeps steers in the transcript and only queued messages in the tray', () => {
  const steer: QueuedMessage = { id: 's', text: 'Use the other file', mode: 'steer' }
  const later: QueuedMessage = { id: 'q', text: 'Then run tests', mode: 'queue' }
  expect(splitSteering([steer, later])).toEqual({ tray: [later], steering: [steer] })
})
