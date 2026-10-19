import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { FileWatchers } from '../src/ipc/watchers'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ramu-file-watch-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const send = vi.fn()
  const watchers = new FileWatchers(send)
  cleanup.push(() => watchers.close())
  return { root, send, watchers }
}
const changes = (send: ReturnType<typeof vi.fn>) => send.mock.calls.filter(([channel]) => channel === 'fs:changed')

it('shares one watcher between tasks and closes it only after the last lease is released', async () => {
  const { root, send, watchers } = fixture()
  watchers.ensure(root, 'a')
  watchers.ensure(root, 'b')
  watchers.ensure(root, 'b')
  expect(watchers.size).toBe(1)
  watchers.release('a')
  expect(watchers.size).toBe(1)
  writeFileSync(join(root, 'one.txt'), '1')
  await vi.waitFor(() => expect(changes(send).map(([, p]) => p)).toContainEqual({ cwd: root, path: 'one.txt' }), {
    timeout: 5000,
  })
  watchers.release('b')
  expect(watchers.size).toBe(0)
})

it('stops reporting and drops pending notifications once released, and can be leased again', async () => {
  const { root, send, watchers } = fixture()
  watchers.ensure(root, 'a')
  writeFileSync(join(root, 'late.txt'), '1')
  await new Promise((resolve) => setTimeout(resolve, 20))
  watchers.release('a')
  writeFileSync(join(root, 'after.txt'), '2')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(changes(send)).toHaveLength(0)
  watchers.ensure(root, 'a')
  expect(watchers.size).toBe(1)
  writeFileSync(join(root, 'again.txt'), '3')
  await vi.waitFor(() => expect(changes(send).map(([, p]) => p.path)).toContain('again.txt'), { timeout: 5000 })
})

it('ignores releasing an unknown task and closes every watcher on shutdown', () => {
  const { root, watchers } = fixture()
  watchers.ensure(root, 'a')
  watchers.release('missing')
  expect(watchers.size).toBe(1)
  watchers.close()
  expect(watchers.size).toBe(0)
})
