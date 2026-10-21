import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { saveBrowserDownload } from '../src/browser/download'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ramu-browser-save-'))
  roots.push(root)
  await mkdir(join(root, 'workspace'))
  await mkdir(join(root, 'additional'))
  return {
    root,
    session: { cwd: join(root, 'workspace'), additionalDirs: [join(root, 'additional')] } as AgentSessionInfo,
  }
}
const read = async (offset: number) => ({ offset, size: 5, data: Buffer.from('hello').toString('base64') })
it('creates new files only in the run workspace and authorized additional roots, without overwriting', async () => {
  const { root, session } = await setup()
  await saveBrowserDownload(session, 'report', 0, read, () => {})
  expect(await readFile(join(root, 'workspace', 'report'), 'utf8')).toBe('hello')
  await saveBrowserDownload(session, 'report', 1, read, () => {})
  await expect(saveBrowserDownload(session, 'report', 0, read, () => {})).rejects.toThrow()
  await writeFile(join(root, 'secret'), 'keep')
  await symlink(root, join(root, 'workspace', 'escape'))
  for (const path of ['../secret', join(root, 'secret'), 'escape/secret', '.git/config'])
    await expect(saveBrowserDownload(session, path, 0, read, () => {})).rejects.toThrow()
  expect(await readFile(join(root, 'secret'), 'utf8')).toBe('keep')
})
it('removes incomplete files after malformed chunks, a disconnect or cancellation', async () => {
  const { root, session } = await setup()
  await expect(
    saveBrowserDownload(
      session,
      'broken',
      0,
      async () => ({ offset: 1, size: 1, data: 'YQ==' }),
      () => {},
    ),
  ).rejects.toThrow('Invalid')
  const active = vi
    .fn()
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw new Error('stopped')
    })
  await expect(saveBrowserDownload(session, 'stopped', 0, read, active)).rejects.toThrow('stopped')
  expect(await readdir(join(root, 'workspace'))).toEqual([])
})
