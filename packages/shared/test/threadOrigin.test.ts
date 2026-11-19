import { expect, it } from 'vitest'
import type { Task } from '../src/types'
import { startedFromTerminal, threadState } from '../src/workspace/threadOrigin'

const task = (extra: Partial<Task>): Task => ({ id: 't', status: 'idle', ...extra }) as Task

it('reads a thread as waiting on the person before anything else, then working, then how it ended', () => {
  expect(threadState(task({ inputSummary: { count: 1 } as Task['inputSummary'], executionState: 'running' }))).toBe(
    'waiting',
  )
  expect(threadState(task({ executionState: 'starting' }))).toBe('running')
  expect(threadState(task({ executionState: 'failed' }))).toBe('failed')
  expect(threadState(task({ executionState: 'stopped' }))).toBe('stopped')
  expect(threadState(task({}))).toBe('finished')
})

it('knows a thread a terminal started from its origin', () => {
  expect(startedFromTerminal({ groupId: 'terminal:abc' })).toBe(true)
  expect(startedFromTerminal({ groupId: 'continue:x' })).toBe(false)
  expect(startedFromTerminal(null)).toBe(false)
})
