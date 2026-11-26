import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RunningCalls, watchStalls } from '../src/stallWatch'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('notes a pause long enough for windows to notice, naming the calls running oldest first', async () => {
  const calls = new RunningCalls()
  const logged: string[] = []
  const stop = watchStalls(
    () => calls.list(),
    (line) => logged.push(line),
  )
  calls.start('agent.events')
  vi.setSystemTime(Date.now() + 2000)
  const done = calls.start('scm.status')
  await vi.advanceTimersByTimeAsync(3000)
  expect(logged).toEqual([])
  // The process was held for eight seconds between two ticks.
  vi.setSystemTime(Date.now() + 8000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(logged).toEqual(['The service paused for 8.0 s. Calls running: agent.events (14.0 s), scm.status (12.0 s).'])
  done()
  expect(calls.list()).toEqual([expect.stringMatching(/^agent\.events/)])
  stop()
})
