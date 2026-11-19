import { expect, it } from 'vitest'
import { checkpointMarkdown } from '../src/chat/checkpointMarkdown'

it('turns a labelled paragraph into sections and keeps its words', () => {
  expect(
    checkpointMarkdown('Objective: rank Ramu. Completed: gave a ranking. Edited README.md. Next: review the diff.'),
  ).toBe(
    '## Objective\n\nrank Ramu.\n\n## Done\n\n- gave a ranking.\n- Edited README.md.\n\n## Next\n\nreview the diff.',
  )
})

it('leaves structured and unlabelled summaries alone', () => {
  expect(checkpointMarkdown('## Objective\n\nShip it. Next: test.')).toBe('## Objective\n\nShip it. Next: test.')
  expect(checkpointMarkdown('Just some notes. Next: test.')).toBe('Just some notes. Next: test.')
})
