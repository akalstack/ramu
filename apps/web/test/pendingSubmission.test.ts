import { expect, it } from 'vitest'
import type { AgentEvent, Attachment, QueuedMessage } from '@ramu/shared/types'
import {
  pendingSubmissionVisible,
  splitSteering,
  type PendingSubmission,
} from '../src/views/agent/lib/pendingSubmission'
const pending: PendingSubmission = { text: 'Hello', attachments: [], afterEvent: 1, queuedIds: ['older'] }
const old: AgentEvent = { kind: 'user', text: 'Hello' }
it('shows feedback before the host replies without confusing an older identical message for this send', () => {
  expect(pendingSubmissionVisible(pending, [old], [])).toBe(true)
})
it('replaces feedback with the host echo, including attached file context', () => {
  expect(pendingSubmissionVisible(pending, [old, { kind: 'user', text: 'Hello\n\n<ramu-context>\nFiles' }], [])).toBe(
    false,
  )
})
it('keeps feedback for unrelated messages and sub-agent output', () => {
  expect(
    pendingSubmissionVisible(
      pending,
      [old, { kind: 'user', text: 'Hello', agentId: 'helper' }, { kind: 'user', text: 'Other message' }],
      [],
    ),
  ).toBe(true)
})
it('replaces feedback with a newly accepted durable queue entry', () => {
  const queued: QueuedMessage = { id: 'older', text: 'Hello', mode: 'queue' }
  expect(pendingSubmissionVisible(pending, [old], [queued])).toBe(true)
  expect(pendingSubmissionVisible(pending, [old], [{ ...queued, id: 'new' }])).toBe(false)
})
it('matches attachment-only messages by their exact attachment identities', () => {
  const attachments = [{ id: 'image' }] as Attachment[]
  const sent = { ...pending, text: '', attachments }
  expect(pendingSubmissionVisible(sent, [old, { kind: 'user', text: '', attachments }], [])).toBe(false)
  expect(
    pendingSubmissionVisible(
      sent,
      [old, { kind: 'user', text: '', attachments: [{ id: 'different' }] as Attachment[] }],
      [],
    ),
  ).toBe(true)
})
it('keeps a just-sent steer out of the queue until it has waited past the grace period', () => {
  const steer: QueuedMessage = { id: 's', text: 'Use the other file', mode: 'steer' }
  const later: QueuedMessage = { id: 'q', text: 'Then run tests', mode: 'queue' }
  const seenAt = new Map([
    ['s', 1000],
    ['q', 1000],
  ])
  expect(splitSteering([steer, later], seenAt, 1500, 1000)).toEqual({ tray: [later], steering: [steer] })
  expect(splitSteering([steer, later], seenAt, 2000, 1000)).toEqual({ tray: [steer, later], steering: [] })
})
