import { expect, it } from 'vitest'
import { WorkLimiter } from '../src/limits'

it('bounds global work and work per host, without blocking other hosts behind a busy host', () => {
  const limiter = new WorkLimiter(3, 1)
  const releases: (() => void)[] = [],
    started: string[] = []
  const start = (key: string) =>
    limiter.schedule(key, (release) => {
      started.push(key)
      releases.push(release)
    })
  start('a')
  start('a')
  start('b')
  start('c')
  start('d')
  expect(started).toEqual(['a', 'b', 'c'])
  releases[0]!()
  expect(started).toEqual(['a', 'b', 'c', 'a'])
  releases[1]!()
  expect(started).toEqual(['a', 'b', 'c', 'a', 'd'])
  for (const release of releases) release()
})

it('cancels queued work and aborts queued request permits', async () => {
  const limiter = new WorkLimiter(1, 1)
  let release!: () => void
  limiter.schedule('a', (done) => {
    release = done
  })
  let calls = 0
  const cancel = limiter.schedule('b', () => {
    calls++
  })
  cancel()
  const controller = new AbortController()
  const waiting = limiter.acquire('c', controller.signal)
  controller.abort()
  await expect(waiting).rejects.toThrow('cancelled')
  release()
  expect(calls).toBe(0)
})
