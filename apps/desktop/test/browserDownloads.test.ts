import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserDownloads, type GuestDownload } from '../src/main/browserDownloads'
const roots: string[] = []
const stores: BrowserDownloads[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.useRealTimers()
})
const owner = { hostId: 'local', threadId: 'thread', runId: 'run', tabId: 'tab', generation: 1 }
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ramu-download-test-'))
  roots.push(root)
  const store = new BrowserDownloads(join(root, 'staging'))
  stores.push(store)
  let path = '',
    received = 0
  let done: (state: 'completed' | 'cancelled' | 'interrupted') => void = () => {}
  let updated: () => void = () => {}
  const item: GuestDownload = {
    name: () => '../../report.txt',
    total: () => 5,
    received: () => received,
    saveTo: (value) => {
      path = value
    },
    cancel: vi.fn(),
    updated: (callback) => {
      updated = callback
    },
    done: (callback) => {
      done = callback
    },
  }
  return {
    store,
    item,
    root,
    complete() {
      writeFileSync(path, 'hello')
      received = 5
      done('completed')
    },
    grow() {
      received = 33 * 1024 * 1024
      updated()
    },
    path: () => path,
  }
}
it('requires a one-use grant, stages without website paths and transfers only to the original controller', () => {
  const s = setup()
  expect(s.store.accept(owner, s.item)).toBe(false)
  s.store.prepare(owner)
  expect(s.store.accept(owner, s.item)).toBe(true)
  expect(s.store.accept(owner, s.item)).toBe(false)
  s.complete()
  const info = s.store.list('local', 'thread')[0]!
  expect(info.name).not.toContain('/')
  expect(s.store.list('local', 'other')).toEqual([])
  expect(s.store.read(info.id, owner, 0)).toEqual({ data: Buffer.from('hello').toString('base64'), offset: 0, size: 5 })
  expect(() => s.store.read(info.id, { ...owner, generation: 2 }, 0)).toThrow('control changed')
  expect(() => s.store.read(info.id, { ...owner, threadId: 'other' }, 0)).toThrow('another thread')
  s.store.save(info.id, 'local', 'thread', join(s.root, 'saved.txt'))
  expect(existsSync(join(s.root, 'saved.txt'))).toBe(true)
})
it('revokes active downloads on takeover and stop but preserves completed files for human saving', () => {
  const s = setup()
  s.store.prepare(owner)
  s.store.accept(owner, s.item)
  s.store.revoke(owner.tabId)
  expect(s.item.cancel).toHaveBeenCalledOnce()
  expect(s.store.list('local', 'thread')).toEqual([])
  s.store.prepare(owner)
  s.store.accept(owner, s.item)
  s.complete()
  s.store.endRun('local', 'thread', 'run')
  expect(s.store.list('local', 'thread')).toHaveLength(1)
})
it('expires grants, rejects changed generations, cancels oversized/slow transfers and removes retained bytes', () => {
  vi.useFakeTimers()
  const s = setup()
  s.store.prepare(owner)
  vi.advanceTimersByTime(60_001)
  expect(s.store.accept(owner, s.item)).toBe(false)
  s.store.prepare(owner)
  expect(s.store.accept({ ...owner, generation: 2 }, s.item)).toBe(false)
  s.store.prepare(owner)
  s.store.accept(owner, s.item)
  s.grow()
  expect(s.item.cancel).toHaveBeenCalledOnce()
  s.store.prepare(owner)
  s.store.accept(owner, s.item)
  vi.advanceTimersByTime(120_000)
  expect(s.item.cancel).toHaveBeenCalledTimes(2)
  s.store.prepare(owner)
  s.store.accept(owner, s.item)
  s.complete()
  expect(existsSync(s.path())).toBe(true)
  vi.advanceTimersByTime(60 * 60_000)
  expect(existsSync(s.path())).toBe(false)
})
