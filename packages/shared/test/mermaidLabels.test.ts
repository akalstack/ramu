import { expect, it } from 'vitest'
import { mermaidLabels, withMermaidLabels } from '../src/mermaidLabels'

const FLOW =
  'flowchart LR\n  %% a note [not this]\n  A[Start] --> B{Decide?}\n  B -->|Yes| C(Do it)\n  B -->|No| D(("Wait (a bit)"))\n  C --> E[[Done]]'

it('lists node and edge labels in source order, skipping comments', () => {
  expect(mermaidLabels(FLOW)).toEqual(['Start', 'Decide?', 'Yes', 'Do it', 'No', 'Wait (a bit)', 'Done'])
  expect(mermaidLabels('sequenceDiagram\n  A->>B: Hi')).toEqual([])
})

it('replaces labels where they stand, keeping ids, arrows, quotes and emptied labels', () => {
  const next = withMermaidLabels(FLOW, ['Begin', 'Ready?', 'Sure', '', 'Not yet', 'Hold on', 'Shipped [v2]'])
  expect(next).toBe(
    'flowchart LR\n  %% a note [not this]\n  A[Begin] --> B{Ready?}\n  B -->|Sure| C(Do it)\n  B -->|Not yet| D(("Hold on"))\n  C --> E[[Shipped  v2]]',
  )
  expect(mermaidLabels(next)).toHaveLength(7)
  expect(() => withMermaidLabels(FLOW, ['one'])).toThrow('changed while you were editing')
})
