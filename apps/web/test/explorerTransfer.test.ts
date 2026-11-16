import { beforeEach, expect, it, vi } from 'vitest'
import type { TransferManifest } from '@ramu/shared/types'

/** Two fake hosts: `a` holds the files, `b` records what it receives. */
const calls: { host: string; method: string; args: unknown[] }[] = []
const files: Record<string, string> = { 'docs/a.txt': 'alpha', 'docs/empty.txt': '' }
const manifest: TransferManifest = {
  entries: [
    { root: 0, path: 'docs', kind: 'dir', size: 0, mode: 0o755 },
    { root: 0, path: 'docs/a.txt', kind: 'file', size: 5, mode: 0o644 },
    { root: 0, path: 'docs/empty.txt', kind: 'file', size: 0, mode: 0o644 },
  ],
  bytes: 5,
}
let failWrites = false
const call = async (host: string, method: string, ...args: unknown[]) => {
  calls.push({ host, method, args })
  if (method === 'files.transfer.manifest') return manifest
  if (method === 'files.transfer.read') {
    const text = files[args[2] as string]!.slice(args[3] as number)
    return { data: btoa(text), gzip: false, bytes: text.length }
  }
  if (method === 'files.transfer.begin') return { id: 'copy-1' }
  if (method === 'files.transfer.write' && failWrites) throw new Error('disk full')
  if (method === 'files.transfer.finish') return ['docs']
  return undefined
}
vi.mock('../src/ipc', () => ({ invokeOn: call, invokeUncachedOn: call }))
const { copyBetweenHosts, formatSize } = await import('../src/sidebar/explorer/transfer')

beforeEach(() => {
  calls.length = 0
  failWrites = false
})

const source = { taskId: 't', repoId: 'r', paths: ['docs'] }
const target = { taskId: 't2', repoId: 'r2', dir: 'inbox' }

it('sends folders first, then every file including empty ones, and places them on the other host', async () => {
  const progress: number[] = []
  const done = await copyBetweenHosts({
    from: 'a',
    source,
    to: 'b',
    target,
    onProgress: (p) => progress.push(p.bytes),
  })
  expect(done).toEqual(['docs'])
  const writes = calls.filter((c) => c.method === 'files.transfer.write').map((c) => c.args[1] as { path: string })
  expect(writes.map((w) => w.path)).toEqual(['docs', 'docs/a.txt', 'docs/empty.txt'])
  expect(calls.filter((c) => c.method === 'files.transfer.read').every((c) => c.host === 'a')).toBe(true)
  expect(calls.at(-1)).toEqual({ host: 'b', method: 'files.transfer.finish', args: ['copy-1', target] })
  expect(progress.at(-1)).toBe(5)
})

it('discards the staged copy when it fails or is cancelled', async () => {
  failWrites = true
  await expect(copyBetweenHosts({ from: 'a', source, to: 'b', target })).rejects.toThrow('disk full')
  expect(calls.at(-1)).toMatchObject({ host: 'b', method: 'files.transfer.cancel' })

  failWrites = false
  calls.length = 0
  const controller = new AbortController()
  controller.abort()
  await expect(copyBetweenHosts({ from: 'a', source, to: 'b', target, signal: controller.signal })).rejects.toThrow(
    'cancelled',
  )
  expect(calls.some((c) => c.method === 'files.transfer.finish')).toBe(false)
  expect(calls.at(-1)).toMatchObject({ method: 'files.transfer.cancel' })
})

it('formats sizes in readable units', () => {
  expect(formatSize(512)).toMatch(/512/)
  expect(formatSize(5 * 1024 * 1024)).toMatch(/5/)
  expect(formatSize(5 * 1024 * 1024)).toMatch(/MB/)
})
