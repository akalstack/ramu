import { expect, it } from 'vitest'
import { runTone } from '../src/scheduleRuns'

it('colours a schedule run the way thread marks are coloured', () => {
  const statuses = [
    'running',
    'queued',
    'needs-input',
    'missed',
    'failed',
    'interrupted',
    'completed',
    'cancelled',
  ] as const
  expect(statuses.map(runTone)).toEqual(['accent', 'accent', 'warn', 'warn', 'bad', 'bad', 'ok', 'muted'])
})
