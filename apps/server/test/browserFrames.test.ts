import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserFrames, type FrameProtocol } from '../src/browser/browserFrames'

let receive: Parameters<FrameProtocol['listen']>[0]
let frames: BrowserFrames
const send = vi.fn(async (_method: string, _params?: Record<string, unknown>) => {})
const off = vi.fn()
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const frame = (data: string, sessionId = 1) =>
  receive({ data, sessionId, metadata: { deviceWidth: 1024, deviceHeight: 768 } })
beforeEach(() => {
  vi.useFakeTimers()
  send.mockClear()
  off.mockClear()
  frames = new BrowserFrames({
    send,
    listen: (listener) => {
      receive = listener
      return off
    },
  })
})
afterEach(() => {
  frames.close()
  vi.useRealTimers()
})

it('shares one capture feed and gives slow viewers the newest frame without a backlog', async () => {
  const first = frames.next(0),
    second = frames.next(0)
  await flush()
  frame('first')
  expect(await first).toMatchObject({ data: 'first', sequence: 1, width: 1024, height: 768 })
  expect(await second).toMatchObject({ sequence: 1 })
  frame('superseded', 2)
  frame('newest', 3)
  expect(await frames.next(1)).toMatchObject({ data: 'newest', sequence: 3 })
  expect(send.mock.calls.filter(([method]) => method === 'Page.startScreencast')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(33)
  expect(send.mock.calls.filter(([method]) => method === 'Page.screencastFrameAck')).toHaveLength(3)
})

it('waits for changes on a still page, stops when unwatched, and restarts without reusing a stale frame', async () => {
  const first = frames.next(0)
  await flush()
  frame('one')
  await first
  const idle = frames.next(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(await idle).toBeNull()
  await vi.advanceTimersByTimeAsync(1500)
  expect(send).toHaveBeenCalledWith('Page.stopScreencast')
  const restarted = frames.next(0)
  await flush()
  frame('fresh')
  expect(await restarted).toMatchObject({ data: 'fresh', sequence: 2 })
})

it('bounds pending viewers and oversized frames, and ends pending reads when the tab closes', async () => {
  const reads = Array.from({ length: 8 }, () => frames.next(0))
  await flush()
  await expect(frames.next(0)).rejects.toThrow('Too many viewers')
  const rejected = reads.map((read) => expect(read).rejects.toThrow('closed'))
  frames.close()
  await Promise.all(rejected)
  await expect(frames.next(0)).rejects.toThrow('closed')
})

it('rejects an oversized compositor image so clients can fall back to bounded screenshots', async () => {
  const read = frames.next(0)
  const rejected = expect(read).rejects.toThrow('live browser frame is unavailable')
  await flush()
  frame('x'.repeat(180_001))
  await rejected
})

it('serializes stop and restart when a viewer returns during shutdown', async () => {
  let finish!: () => void
  send.mockImplementation(async (method) => {
    if (method === 'Page.stopScreencast')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
  })
  const first = frames.next(0)
  await flush()
  frame('old')
  await first
  await vi.advanceTimersByTimeAsync(1500)
  const next = frames.next(1)
  await flush()
  expect(send.mock.calls.filter(([method]) => method === 'Page.startScreencast')).toHaveLength(1)
  finish()
  await flush()
  frame('returned')
  expect(await next).toMatchObject({ data: 'returned', sequence: 2 })
})
