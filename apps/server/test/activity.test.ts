import { expect, it, vi } from 'vitest'
import { ActivityService } from '../src/activity'

it('keeps concurrent operations visible and removes only the completed operation', async () => {
  const changed = vi.fn(), activity = new ActivityService(changed)
  let finish!: () => void
  const first = activity.run('Updating CLI', 'Codex', () => new Promise<void>((resolve) => { finish = resolve }))
  const second = activity.run('Fetching repositories', 'ramu', async () => 42)
  expect(activity.status()).toHaveLength(2)
  expect(await second).toBe(42)
  expect(activity.status().map((item) => item.detail)).toEqual(['Codex'])
  finish(); await first
  expect(activity.status()).toEqual([])
  expect(changed).toHaveBeenLastCalledWith([])
})

it('clears failed activity and preserves the original failure', async () => {
  const activity = new ActivityService(() => {})
  const error = new Error('offline')
  await expect(activity.run('Updating CLI', undefined, () => { throw error })).rejects.toBe(error)
  expect(activity.status()).toEqual([])
})
