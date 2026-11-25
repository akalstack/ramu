import { expect, it } from 'vitest'
import { toolFailure } from '@ramu/shared/chat/toolFailure'
import { summarizeToolResult } from '../src/agent/toolSummaries'

it('keeps the exit code and the end of a long failed output, where the error is', () => {
  const log = [
    'Exit code 1',
    ...Array.from({ length: 200 }, (_, i) => `ok ${i}`),
    'FAIL src/app.test.ts',
    'Expected 2',
  ].join('\n')
  const summary = summarizeToolResult(log, true)
  expect(summary.length).toBeLessThanOrEqual(402)
  expect(toolFailure(summary)).toEqual({ exit: '1', lines: ['ok 199', 'FAIL src/app.test.ts', 'Expected 2'] })
  // A result that did not fail still reads from its start.
  expect(summarizeToolResult(log)).toMatch(/^Exit code 1\nok 0/)
})
