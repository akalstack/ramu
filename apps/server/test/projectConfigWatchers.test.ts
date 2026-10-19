import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectConfigWatchers } from '../src/workspace/projectConfigWatchers'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ramu-config-watch-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const changed = vi.fn()
  const watchers = new ProjectConfigWatchers(changed)
  cleanup.push(() => watchers.close())
  watchers.ensure('project', root)
  return { root, changed, watchers }
}
const delivered = async (changed: ReturnType<typeof vi.fn>, count: number) => {
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(count), { timeout: 5000 })
}

it('observes atomic primary edits, deletion and a fallback directory created after watching starts', async () => {
  const { root, changed } = fixture()
  writeFileSync(join(root, 'ramu.json'), '{}')
  await delivered(changed, 1)
  writeFileSync(join(root, 'editor.tmp'), '{')
  renameSync(join(root, 'editor.tmp'), join(root, 'ramu.json'))
  await delivered(changed, 2)
  rmSync(join(root, 'ramu.json'))
  await delivered(changed, 3)
  mkdirSync(join(root, '.ramu'))
  writeFileSync(join(root, '.ramu/config.json'), '{}')
  await delivered(changed, 4)
  writeFileSync(join(root, '.ramu/config.json'), '{"actions":[]}')
  await delivered(changed, 5)
  renameSync(join(root, '.ramu'), join(root, 'previous-config'))
  mkdirSync(join(root, '.ramu'))
  await delivered(changed, 6)
  writeFileSync(join(root, '.ramu/config.json'), '{}')
  await delivered(changed, 7)
})

it('does not watch arbitrary project files or follow a config directory outside the registered project', async () => {
  const { root, changed, watchers } = fixture()
  const outside = mkdtempSync(join(tmpdir(), 'ramu-config-outside-'))
  cleanup.push(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, 'config.json'), '{}')
  symlinkSync(outside, join(root, '.ramu'))
  await delivered(changed, 1)
  watchers.ensure('project', root)
  writeFileSync(join(outside, 'config.json'), '{"actions":[]}')
  writeFileSync(join(root, 'unrelated.txt'), 'unrelated')
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(changed).toHaveBeenCalledTimes(1)
})

it('coalesces clients and cancels pending notifications when a project is removed or the service closes', async () => {
  const { root, changed, watchers } = fixture()
  watchers.ensure('project', root)
  writeFileSync(join(root, 'ramu.json'), '{}')
  await delivered(changed, 1)
  watchers.retain([])
  writeFileSync(join(root, 'ramu.json'), '{')
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(changed).toHaveBeenCalledTimes(1)
  watchers.ensure('project', root)
  writeFileSync(join(root, 'ramu.json'), '{}')
  watchers.close()
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(changed).toHaveBeenCalledTimes(1)
})

it('rebinds after a project root is replaced without another client read', async () => {
  const { root, changed } = fixture()
  writeFileSync(join(root, 'ramu.json'), '{}')
  await delivered(changed, 1)
  const old = `${root}-old`
  cleanup.unshift(() => rmSync(old, { recursive: true, force: true }))
  renameSync(root, old)
  mkdirSync(root)
  writeFileSync(join(root, 'ramu.json'), '{"actions":[]}')
  await delivered(changed, 2)
  writeFileSync(join(root, 'ramu.json'), '{"name":"Replacement"}')
  await delivered(changed, 3)
  writeFileSync(join(old, 'ramu.json'), '{"name":"Old root"}')
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(changed).toHaveBeenCalledTimes(3)
})

it('observes internal file symlink targets, atomic edits and replaced target directories', async () => {
  const { root, changed } = fixture()
  mkdirSync(join(root, 'config'))
  writeFileSync(join(root, 'config/shared.json'), '{}')
  symlinkSync('config/shared.json', join(root, 'ramu.json'))
  await delivered(changed, 1)
  writeFileSync(join(root, 'config/editor.tmp'), '{"name":"Atomic edit"}')
  renameSync(join(root, 'config/editor.tmp'), join(root, 'config/shared.json'))
  await delivered(changed, 2)
  renameSync(join(root, 'config'), join(root, 'old-config'))
  mkdirSync(join(root, 'config'))
  writeFileSync(join(root, 'config/shared.json'), '{"name":"New directory"}')
  await delivered(changed, 3)
  writeFileSync(join(root, 'config/shared.json'), '{"name":"Still watched"}')
  await delivered(changed, 4)
  rmSync(join(root, 'config/shared.json'))
  await delivered(changed, 5)
  writeFileSync(join(root, 'config/shared.json'), '{"name":"Recreated target"}')
  await delivered(changed, 6)
})

it('tracks internal fallback directory and file symlinks', async () => {
  const { root, changed } = fixture()
  mkdirSync(join(root, 'settings'))
  mkdirSync(join(root, 'data'))
  writeFileSync(join(root, 'data/shared.json'), '{}')
  symlinkSync('../data/shared.json', join(root, 'settings/config.json'))
  symlinkSync('settings', join(root, '.ramu'))
  await delivered(changed, 1)
  writeFileSync(join(root, 'data/shared.json'), '{"name":"Updated fallback"}')
  await delivered(changed, 2)
})
