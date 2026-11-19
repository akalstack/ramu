import { expect, it, vi } from 'vitest'
import { RemoteRefresh } from '../src/workspace/remoteRefresh'

const clock = () => {
  const time = { now: 1_000_000 }
  return { time, refresh: new RemoteRefresh(() => time.now) }
}

it('fetches once when a repository is reopened or a second client looks at it', async () => {
  const { time, refresh } = clock()
  const fetch = vi.fn().mockResolvedValue(true)
  expect(await refresh.visit('a', fetch)).toBe(true)
  expect(await refresh.visit('a', fetch)).toBeNull()
  expect(await refresh.visit('b', fetch)).toBe(true)
  time.now += 2 * 60_000
  expect(await refresh.visit('a', fetch)).toBeNull()
  time.now += 60_000
  expect(await refresh.visit('a', fetch)).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('does not run two fetches for one repository at once', async () => {
  const { refresh } = clock()
  let finish = (_: boolean) => {}
  const fetch = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
  const first = refresh.visit('a', fetch)
  expect(await refresh.visit('a', fetch)).toBeNull()
  finish(true)
  expect(await first).toBe(true)
  expect(fetch).toHaveBeenCalledOnce()
})

it('keeps backing off a failing remote across visits', async () => {
  const { time, refresh } = clock()
  const fetch = vi.fn().mockRejectedValue(new Error('network down'))
  await refresh.visit('a', fetch)
  time.now += 90_000
  await refresh.visit('a', fetch)
  expect(fetch).toHaveBeenCalledTimes(1)
  time.now += 40_000
  await refresh.visit('a', fetch)
  expect(fetch).toHaveBeenCalledTimes(2)
  time.now += 3 * 60_000
  await refresh.visit('a', fetch)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('waits long after an authentication failure until a manual fetch works', async () => {
  const { time, refresh } = clock()
  const fetch = vi.fn().mockRejectedValue(new Error('Permission denied (publickey)'))
  await refresh.visit('a', fetch)
  time.now += 30 * 60_000
  await refresh.visit('a', fetch)
  expect(fetch).toHaveBeenCalledTimes(1)
  refresh.fetched('a')
  time.now += 3 * 60_000
  await refresh.visit('a', fetch)
  expect(fetch).toHaveBeenCalledTimes(2)
})
