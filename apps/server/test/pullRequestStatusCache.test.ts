import { expect, it, vi } from 'vitest'
import type { ForgeStatus } from '@ramu/shared/types'
import { PullRequestStatusCache, STATUS_TTL } from '../src/workspace/forge/statusCache'

const open = { availability: 'ready', pullRequest: { state: 'open' } } as unknown as ForgeStatus
const merged = { availability: 'ready', pullRequest: { state: 'merged' } } as unknown as ForgeStatus

it('shares one read between callers, including ones that ask while it runs', async () => {
  const cache = new PullRequestStatusCache()
  const load = vi.fn(async () => open)
  const [first, second] = await Promise.all([
    cache.read('/a', 'b', undefined, load),
    cache.read('/a', 'b', undefined, load),
  ])
  expect(first).toBe(second)
  await cache.read('/a', 'b', undefined, load)
  expect(load).toHaveBeenCalledOnce()
})

it('reads an open pull request again sooner than a merged one, and per branch', async () => {
  let now = 0
  const cache = new PullRequestStatusCache(() => now)
  const load = vi.fn(async () => open)
  await cache.read('/a', 'b', undefined, load)
  now = STATUS_TTL.open + 1
  await cache.read('/a', 'b', undefined, load)
  expect(load).toHaveBeenCalledTimes(2)
  await cache.read('/a', 'other', undefined, load)
  expect(load).toHaveBeenCalledTimes(3)
  const settled = vi.fn(async () => merged)
  await cache.read('/m', 'b', undefined, settled)
  now += STATUS_TTL.open * 4
  await cache.read('/m', 'b', undefined, settled)
  expect(settled).toHaveBeenCalledOnce()
})

it('asks again after forget, a fresh read or a failure', async () => {
  const cache = new PullRequestStatusCache()
  const load = vi.fn(async () => open)
  await cache.read('/a', 'b', undefined, load)
  cache.forget('/a')
  await cache.read('/a', 'b', undefined, load)
  await cache.read('/a', 'b', undefined, load, true)
  expect(load).toHaveBeenCalledTimes(3)
  const failing = vi.fn(async () => {
    throw new Error('offline')
  })
  await expect(cache.read('/f', 'b', undefined, failing)).rejects.toThrow('offline')
  await expect(cache.read('/f', 'b', undefined, failing)).rejects.toThrow('offline')
  expect(failing).toHaveBeenCalledTimes(2)
})
