import { expect, it } from 'vitest'
import type { ResourceSnapshot } from '@ramu/shared/resources'
import { serviceIsIdle } from '../src/main/serviceIdle'

const read = (running: number, needsInput: number, kinds: string[] = []) => ({
  counts: async () => ({ running, needsInput }),
  resources: async () =>
    ({
      threads: kinds.length ? [{ taskId: 't', items: kinds.map((kind) => ({ kind })) }] : [],
    }) as unknown as ResourceSnapshot,
})

it('is idle only when no agent, terminal, command or device is live', async () => {
  expect(await serviceIsIdle(read(0, 0))).toBe(true)
  expect(await serviceIsIdle(read(1, 0))).toBe(false)
  expect(await serviceIsIdle(read(0, 1))).toBe(false)
  for (const kind of ['terminal', 'command', 'device', 'agent'])
    expect(await serviceIsIdle(read(0, 0, [kind]))).toBe(false)
})

it('keeps the service when it cannot tell', async () => {
  const unreadable = async () => {
    throw new Error('older service')
  }
  expect(await serviceIsIdle({ ...read(0, 0), counts: unreadable })).toBe(false)
  expect(await serviceIsIdle({ ...read(0, 0), resources: unreadable })).toBe(false)
})
