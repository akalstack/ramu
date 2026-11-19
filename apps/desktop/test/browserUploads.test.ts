import { afterEach, expect, it, vi } from 'vitest'
import { BrowserUploads } from '../src/main/browserUploads'
import { MAX_BROWSER_UPLOAD_BYTES } from '@ramu/shared/browserBridge'
const owner = { hostId: 'host', threadId: 'thread', runId: 'run', tabId: 'tab', generation: 1 }
const stores: BrowserUploads[] = []
const create = () => {
  const store = new BrowserUploads()
  stores.push(store)
  return store
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  vi.useRealTimers()
})
it('assembles exact ordered bytes once and never accepts another owner or replayed chunks', () => {
  const store = create(),
    id = store.begin(owner, 'report.txt', 5)
  expect(store.chunk(id, owner, 0, Buffer.from('hello').toString('base64'))).toBe(5)
  expect(() => store.chunk(id, owner, 0, 'aA==')).toThrow('repeated')
  expect(() => store.consume(id, { ...owner, threadId: 'other' })).toThrow('another')
  expect(store.consume(id, owner)).toEqual({ name: 'report.txt', data: 'aGVsbG8=' })
  expect(() => store.consume(id, owner)).toThrow('already used')
})
it('invalidates changed control, expires staged bytes and clears tab/run transfers', () => {
  vi.useFakeTimers()
  const store = create(),
    id = store.begin(owner, 'empty.txt', 0)
  expect(() => store.consume(id, { ...owner, generation: 2 })).toThrow('control changed')
  const expired = store.begin(owner, 'empty.txt', 0)
  vi.advanceTimersByTime(60_001)
  expect(() => store.consume(expired, owner)).toThrow('expired')
  const tab = store.begin(owner, 'empty.txt', 0)
  store.closeTab(owner.tabId)
  expect(() => store.consume(tab, owner)).toThrow('expired')
  const run = store.begin(owner, 'empty.txt', 0)
  store.endRun(owner.hostId, owner.threadId, owner.runId)
  expect(() => store.consume(run, owner)).toThrow('expired')
})
it('bounds file size, names, active transfers and exact completion', () => {
  const store = create()
  expect(() => store.begin(owner, '../secret', 1)).toThrow('Invalid')
  expect(() => store.begin(owner, 'huge', MAX_BROWSER_UPLOAD_BYTES + 1)).toThrow('Invalid')
  const id = store.begin(owner, 'file', 1)
  expect(() => store.consume(id, owner)).toThrow('incomplete')
  expect(() => store.chunk(id, owner, 0, 'not base64')).toThrow('Invalid')
  expect(() => store.chunk(id, owner, 0, 'aGk=')).toThrow('declared size')
  for (let n = 0; n < 3; n++) store.begin(owner, 'file', 0)
  expect(() => store.begin(owner, 'file', 0)).toThrow('Too many')
})
