import { expect, it, vi } from 'vitest'
import { HostOverviewQueue, readHostOverview } from '../src/main/hostOverview'
import { HostNavigation } from '../src/main/hostNavigation'

it('keeps successful sections when one fails', async () => {
  const invoke = vi.fn(async (method: string) => {
    if (method === 'summaries.get') throw new Error('Memory is unavailable')
    if (method === 'tasks.list') return [{ id: 'remote-task' }]
    return []
  })
  const data = await readHostOverview(invoke)
  expect(data.tasks).toEqual([{ id: 'remote-task' }])
  expect(data.errors).toEqual(['summaries: Memory is unavailable'])
})

it('bounds reads across hosts, joins duplicate requests, and continues after a failure', async () => {
  let active = 0,
    peak = 0
  const releases: (() => void)[] = []
  const queue = new HostOverviewQueue(async (id) => {
    active++
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => releases.push(resolve))
    active--
    if (id === 'bad') throw new Error('Disconnected')
    return { tasks: [], projects: [], summaries: [], agents: [], errors: [] }
  }, 2)
  const a = queue.read('a')
  expect(queue.read('a')).toBe(a)
  const requests = [a, queue.read('bad'), queue.read('c'), queue.read('d')]
  const settled = Promise.allSettled(requests)
  expect(active).toBe(2)
  while (releases.length) {
    releases.shift()!()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect((await settled).map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
  expect(peak).toBe(2)
})

it('keeps only the latest shell selection and waits through a renderer reload', () => {
  const send = vi.fn()
  const navigation = new HostNavigation(send)
  navigation.request('a', { kind: 'task', taskId: 'same' })
  navigation.request('b', { kind: 'summary', summaryId: 'latest' })
  expect(send).not.toHaveBeenCalled()
  navigation.ready()
  expect(send).toHaveBeenLastCalledWith('b', { kind: 'summary', summaryId: 'latest' })
  navigation.suspend()
  navigation.request('a', { kind: 'new' })
  expect(send).toHaveBeenCalledTimes(1)
  navigation.ready()
  expect(send).toHaveBeenLastCalledWith('a', { kind: 'new' })
  navigation.suspend()
  navigation.request('a', { kind: 'inbox' })
  navigation.forget('a')
  navigation.ready()
  expect(send).toHaveBeenCalledTimes(2)
})
