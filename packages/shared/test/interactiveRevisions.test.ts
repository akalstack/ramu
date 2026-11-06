import { expect, it } from 'vitest'
import {
  interactiveRevisions,
  interactiveSourceDiff,
  interactiveSuccessor,
  interactiveUpdates,
} from '../src/interactiveRevisions'
import type { InteractiveReference } from '../src/interactive'
import type { AgentEvent } from '../src/types'

const ref = (version: number, id = 'doc', changes?: string): InteractiveReference => ({
  id,
  version,
  sessionId: 's',
  title: 'Calculator',
  summary: '',
  digest: 'd',
  createdAt: version,
  checked: true,
  network: { resources: [], connect: [] },
  ...(changes ? { changes } : {}),
})
const card = (reference: InteractiveReference) => ({ kind: 'interactive', reference }) as AgentEvent
const previewCall = (toolUseId: string, previous?: { id: string; version: number }) =>
  ({
    kind: 'tool-use',
    toolUseId,
    name: 'mcp__ramu__preview_interactive',
    summary: '',
    input: JSON.stringify({ title: 'x', ...(previous ? { previous } : {}) }),
  }) as AgentEvent
const previewResult = (toolUseId: string, body: unknown, isError = false) =>
  ({
    kind: 'tool-result',
    toolUseId,
    isError,
    summary: '',
    content: [{ type: 'text', text: JSON.stringify(body) }],
  }) as AgentEvent

it('keeps one live version per document and names what replaced each older one', () => {
  const events = [card(ref(1)), card(ref(1, 'other')), card(ref(2, 'doc', 'Adds tips')), card(ref(3, 'doc', 'Splits'))]
  const revisions = interactiveRevisions(events)
  expect(revisions.get('doc')?.latest.version).toBe(3)
  expect(revisions.get('doc')?.versions.map((entry) => entry.version)).toEqual([3, 2, 1])
  expect(revisions.get('other')?.latest.version).toBe(1)
  expect(interactiveSuccessor(ref(1), revisions.get('doc'))?.changes).toBe('Adds tips')
  expect(interactiveSuccessor(ref(3), revisions.get('doc'))).toBeUndefined()
})

it('marks a document updating while its revision is previewed, and says why one did not publish', () => {
  const previous = { id: 'doc', version: 1 }
  expect(interactiveUpdates([card(ref(1)), previewCall('a', previous)]).get('doc')).toEqual({ state: 'updating' })
  // A preview of something new is not an update of an existing card.
  expect(interactiveUpdates([card(ref(1)), previewCall('a')]).size).toBe(0)
  const failed = interactiveUpdates([
    card(ref(1)),
    previewCall('a', previous),
    previewResult('a', { errors: ['x is not defined'], checks: [] }),
  ])
  expect(failed.get('doc')).toEqual({ state: 'failed', detail: 'x is not defined' })
  const check = interactiveUpdates([
    previewCall('a', previous),
    previewResult('a', { errors: [], checks: [{ label: 'Total', passed: false }] }),
  ])
  expect(check.get('doc')).toEqual({ state: 'failed', detail: 'Check failed: Total' })
  // Publishing the revision ends the update.
  expect(
    interactiveUpdates([
      previewCall('a', previous),
      previewResult('a', { errors: [], checks: [] }),
      card(ref(2, 'doc', 'New')),
    ]).size,
  ).toBe(0)
})

it('diffs sources line by line around the change', () => {
  const diff = interactiveSourceDiff('a\nb\nc\nd', 'a\nb\nC\nd\ne')
  expect(diff).toEqual([
    { kind: ' ', text: 'a' },
    { kind: ' ', text: 'b' },
    { kind: '-', text: 'c' },
    { kind: '+', text: 'C' },
    { kind: ' ', text: 'd' },
    { kind: '+', text: 'e' },
  ])
})
