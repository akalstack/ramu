import { afterEach, expect, it, vi } from 'vitest'
import { ComputerBroadcaster } from '../src/main/computerBroadcast'

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
