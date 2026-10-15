import { afterEach, expect, it, vi } from 'vitest'
import { ComputerBroadcaster } from '../src/main/computerBroadcast'
import { HiddenEvents } from '../src/main/hiddenEvents'
import { WorkspaceViewCache } from '../src/main/viewCache'

afterEach(() => vi.useRealTimers())

it('coalesces a large connection burst into one snapshot for the visible workspace', async () => {
  vi.useFakeTimers()
  const snapshot = vi.fn(() => ({ current: 'a', computers: [], deviceName: 'local' })),
    send = vi.fn()
  const broadcast = new ComputerBroadcaster(snapshot, send)
  for (let i = 0; i < 1000; i++) broadcast.changed()
  await vi.advanceTimersByTimeAsync(50)
  expect(snapshot).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledTimes(1)
  broadcast.close()
})

it('keeps terminal buffering bounded and discards hidden transcript traffic', () => {
  const hidden = new HiddenEvents(20, 15),
    events: [string, any][] = []
  for (let i = 0; i < 1000; i++) hidden.add('agent:event', { event: { text: 'large text' } })
  hidden.add('term:data', { id: 'a', data: 'a'.repeat(20) })
  hidden.add('term:data', { id: 'b', data: 'b'.repeat(20) })
  hidden.add('term:data', { id: 'c', data: 'c'.repeat(20) })
  hidden.drain((channel, payload) => events.push([channel, payload]), 'truncated')
  expect(events.every(([channel]) => channel === 'term:data')).toBe(true)
  expect(
    // eslint-disable-next-line no-control-regex -- matches the terminal escape sequences emitted by the truncation notice
    events.map(([, payload]) => payload.data.replace(/\x1bc\x1b\[2m\[truncated\]\x1b\[0m\r\n/g, '')).join('').length,
  ).toBeLessThanOrEqual(20)
  expect(events.some(([, payload]) => payload.data.includes('truncated'))).toBe(true)
})

it('releases least-recent clean views while protecting dirty work and the visible view', async () => {
  const released: string[] = []
  let tick = 0
  const cache = new WorkspaceViewCache(
    async (id) => id !== 'dirty',
    (id) => released.push(id),
    2,
    1000,
    () => ++tick,
  )
  cache.show('dirty')
  cache.show('clean-a')
  cache.show('clean-b')
  cache.show('visible')
  await expect.poll(() => released.length).toBe(2)
  expect(released).toContain('clean-a')
  expect(released).toContain('clean-b')
  expect(released).not.toContain('dirty')
  expect(released).not.toContain('visible')
  cache.close()
})

it('never releases a view that was shown while its checkpoint was pending', async () => {
  let reply!: (safe: boolean) => void
  const release = vi.fn()
  const cache = new WorkspaceViewCache(
    () =>
      new Promise((resolve) => {
        reply = resolve
      }),
    release,
    1,
  )
  cache.show('a')
  cache.show('b')
  cache.show('a')
  reply(true)
  await Promise.resolve()
  await Promise.resolve()
  expect(release).not.toHaveBeenCalledWith('a')
  cache.close()
})
