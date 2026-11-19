import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserInputQueue, watchBrowserFrames } from '../src/browserLiveViewer'
import type { BrowserHumanInput, BrowserLiveFrame } from '../src/browserBridge'
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const image: BrowserLiveFrame = { mimeType: 'image/jpeg', data: 'jpeg', width: 1024, height: 768, sequence: 1 }

it('reads live frames independently without a fixed screenshot delay and ignores late frames after stopping', async () => {
  let finish!: (value: BrowserLiveFrame) => void
  const next = vi
    .fn()
    .mockResolvedValueOnce(image)
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  const show = vi.fn(),
    ready = vi.fn(),
    fallback = vi.fn()
  const stop = watchBrowserFrames({ next, fallback, show, ready, error: vi.fn() })
  await flush()
  expect(show).toHaveBeenCalledWith(image)
  await vi.advanceTimersByTimeAsync(33)
  expect(next).toHaveBeenLastCalledWith(1)
  stop()
  finish({ ...image, sequence: 2 })
  await flush()
  expect(show).toHaveBeenCalledTimes(1)
  expect(fallback).not.toHaveBeenCalled()
})

it('falls back without a compositor feed but never changes transport to evade an access refusal', async () => {
  const fallback = vi.fn().mockResolvedValue(image)
  const next = vi.fn().mockRejectedValue(new Error('Live browser frames are unavailable'))
  const stop = watchBrowserFrames({ next, fallback, show: vi.fn(), ready: vi.fn(), error: vi.fn() })
  await vi.advanceTimersByTimeAsync(750)
  expect(fallback).toHaveBeenCalledTimes(1)
  stop()
  next.mockRejectedValue(new Error('Pair an owner device to use this host browser.'))
  fallback.mockClear()
  const stop2 = watchBrowserFrames({ next, fallback, show: vi.fn(), ready: vi.fn(), error: vi.fn() })
  await vi.advanceTimersByTimeAsync(750)
  expect(fallback).not.toHaveBeenCalled()
  stop2()
})

it('disables input on a stalled frame request and recovers when the connection answers', async () => {
  let finish!: (value: BrowserLiveFrame) => void
  const next = () =>
    new Promise<BrowserLiveFrame>((resolve) => {
      finish = resolve
    })
  const ready = vi.fn()
  const stop = watchBrowserFrames({ next, fallback: vi.fn(), show: vi.fn(), ready, error: vi.fn() })
  await vi.advanceTimersByTimeAsync(5000)
  expect(ready).toHaveBeenLastCalledWith(false)
  finish(image)
  await flush()
  expect(ready).toHaveBeenLastCalledWith(true)
  stop()
})

it('serializes clicks and typing, coalesces adjacent scrolling, and preserves the full displacement', async () => {
  let finish!: () => void
  const sent: BrowserHumanInput[] = []
  const queue = new BrowserInputQueue(async (input) => {
    sent.push(input)
    if (sent.length === 1)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
  })
  const a = queue.push({ kind: 'scroll', x: 0, y: 10 })
  const b = queue.push({ kind: 'scroll', x: 2, y: 20 })
  const c = queue.push({ kind: 'scroll', x: 3, y: 30 })
  const d = queue.push({ kind: 'click', x: 0.5, y: 0.5, button: 'left', clickCount: 1 })
  const e = queue.push({ kind: 'text', text: 'hello' })
  expect(sent).toHaveLength(1)
  finish()
  await Promise.all([a, b, c, d, e])
  expect(sent).toEqual([
    { kind: 'scroll', x: 0, y: 10 },
    { kind: 'scroll', x: 5, y: 50 },
    { kind: 'click', x: 0.5, y: 0.5, button: 'left', clickCount: 1 },
    { kind: 'text', text: 'hello' },
  ])
})

it('drops queued actions on a handoff or uncertain input failure, without replaying mutations', async () => {
  let fail!: (error: Error) => void
  const send = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject
      }),
  )
  const queue = new BrowserInputQueue(send)
  const a = expect(queue.push({ kind: 'key', key: 'Enter' })).rejects.toThrow('disconnected')
  const b = expect(queue.push({ kind: 'text', text: 'must not type' })).rejects.toThrow('disconnected')
  fail(new Error('disconnected'))
  await Promise.all([a, b])
  expect(send).toHaveBeenCalledTimes(1)
  await expect(queue.push({ kind: 'key', key: 'Enter' })).rejects.toThrow('control changed')
})

it('cancels queued input on a control handoff even if an earlier request finishes later', async () => {
  let finish!: () => void
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const queue = new BrowserInputQueue(send)
  const active = queue.push({ kind: 'scroll', x: 0, y: 20 })
  const queued = expect(queue.push({ kind: 'key', key: 'Enter' })).rejects.toThrow('control changed')
  queue.close()
  finish()
  await Promise.all([active, queued])
  expect(send).toHaveBeenCalledTimes(1)
})
