import { expect, it } from 'vitest'
import { partitionHostEntries } from '../src/main/partitionStorage'

it('carries legacy content into its host without mixing device settings or another host', () => {
  expect(
    partitionHostEntries('studio', {
      'ramu.draft.chat:same': 'old draft',
      'host:studio:ramu.draft.chat:same': 'new draft',
      'ramu.unread': '["same"]',
      'ramu.outbox': 'queued',
      'host:laptop:ramu.outbox': 'other queue',
      'ramu.sidebar-width': '250',
      'ramu.layout.tools-rail': '200',
      'ramu.layout.workspace-v2.same': '40',
      'ramu.host-storage': 'studio',
    }),
  ).toEqual({
    'host:studio:ramu.draft.chat:same': 'new draft',
    'host:studio:ramu.unread': '["same"]',
    'host:studio:ramu.outbox': 'queued',
    'host:studio:ramu.layout.workspace-v2.same': '40',
  })
})
