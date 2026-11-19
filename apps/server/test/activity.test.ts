import { expect, it, vi } from 'vitest'
import { ActivityService } from '../src/background/activity'

it('keeps concurrent operations visible and removes only the completed operation', async () => {
  const changed = vi.fn(),
    activity = new ActivityService(changed)
  let finish!: () => void
  const first = activity.run(
    'Updating CLI',
    'Codex',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const second = activity.run('Fetching repositories', 'ramu', async () => 42)
  expect(activity.status()).toHaveLength(2)
  expect(await second).toBe(42)
  expect(activity.status().map((item) => item.detail)).toEqual(['Codex'])
  finish()
  await first
  expect(activity.status()).toEqual([])
  expect(changed).toHaveBeenLastCalledWith([])
})

it('clears failed activity and preserves the original failure', async () => {
  const activity = new ActivityService(() => {})
  const error = new Error('offline')
  await expect(
    activity.run('Updating CLI', undefined, () => {
      throw error
    }),
  ).rejects.toBe(error)
  expect(activity.status()).toEqual([])
})

it('lets the owner cancel a job and keeps it visible until its work settles', async () => {
  const activity = new ActivityService(() => {})
  const controller = new AbortController()
  const work = activity.run(
    'Updating CLI',
    'antigravity',
    () =>
      new Promise<void>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      }),
    () => controller.abort(),
  )
  const item = activity.status()[0]!
  expect(item.cancellable).toBe(true)
  activity.cancel(item.id)
  activity.cancel(item.id)
  expect(activity.status()).toHaveLength(1)
  await expect(work).rejects.toMatchObject({ name: 'AbortError' })
  expect(activity.status()).toEqual([])
  expect(() => activity.cancel(item.id)).toThrow('cannot be stopped')
})

it('does not offer cancellation for work without an owner cancellation hook', async () => {
  const activity = new ActivityService(() => {})
  let finish!: () => void
  const work = activity.run(
    'Committing changes',
    undefined,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const item = activity.status()[0]!
  expect(item.cancellable).toBeUndefined()
  expect(() => activity.cancel(item.id)).toThrow('cannot be stopped')
  expect(activity.status()).toHaveLength(1)
  finish()
  await work
})
