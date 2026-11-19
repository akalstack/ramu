import { expect, it } from 'vitest'
import { RequestReplay } from '../src/agent/requestReplay'

it('returns the first result for a resent call and starts again after a failure or once it expires', async () => {
  let now = 0
  let starts = 0
  const replay = new RequestReplay<number>(1000, 10, () => now)
  const start = () => Promise.resolve(++starts)
  expect(await replay.run('a', start)).toBe(1)
  expect(await replay.run('a', start)).toBe(1)
  expect(await replay.run('b', start)).toBe(2)
  await expect(replay.run('c', () => Promise.reject(new Error('declined')))).rejects.toThrow('declined')
  expect(await replay.run('c', start)).toBe(3)
  now = 2000
  expect(await replay.run('a', start)).toBe(4)
})
