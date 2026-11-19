import { expect, it } from 'vitest'
import { mapBounded } from '../src/mapBounded'

it('keeps order, never exceeds the limit, and rejects on the first failure', async () => {
  let running = 0
  let peak = 0
  const doubled = await mapBounded([1, 2, 3, 4, 5], 2, async (value) => {
    peak = Math.max(peak, ++running)
    await new Promise((resolve) => setTimeout(resolve, 1))
    running--
    return value * 2
  })
  expect(doubled).toEqual([2, 4, 6, 8, 10])
  expect(peak).toBe(2)
  await expect(mapBounded([1], 2, () => Promise.reject(new Error('no')))).rejects.toThrow('no')
  expect(await mapBounded([], 2, async () => 1)).toEqual([])
})
