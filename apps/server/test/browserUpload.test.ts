import { mkdtemp, writeFile, symlink, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { readBrowserUpload } from '../src/browser/upload'
import { MAX_BROWSER_UPLOAD_BYTES } from '@ramu/shared/browserBridge'
const directories: string[] = []
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})
it('reads only regular files from the actual authorized cwd or additional workspace roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ramu-browser-upload-'))
  directories.push(root)
  await mkdir(join(root, 'workspace'))
  await mkdir(join(root, 'additional'))
  await writeFile(join(root, 'workspace', 'report.txt'), 'hello')
  await writeFile(join(root, 'additional', 'other.txt'), 'another')
  await writeFile(join(root, 'secret'), 'outside')
  await symlink(join(root, 'secret'), join(root, 'workspace', 'escape'))
  const session = { cwd: join(root, 'workspace'), additionalDirs: [join(root, 'additional')] } as AgentSessionInfo
  expect((await readBrowserUpload(session, 'report.txt')).data.toString()).toBe('hello')
  expect((await readBrowserUpload(session, 'other.txt', 1)).data.toString()).toBe('another')
  for (const path of ['../secret', join(root, 'secret'), 'escape', '.'])
    await expect(readBrowserUpload(session, path)).rejects.toThrow()
  await expect(readBrowserUpload(session, 'other.txt', 2)).rejects.toThrow('Unknown')
})
it('refuses oversized files before returning any upload bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ramu-browser-upload-'))
  directories.push(root)
  await writeFile(join(root, 'large'), Buffer.alloc(MAX_BROWSER_UPLOAD_BYTES + 1))
  await expect(
    readBrowserUpload({ cwd: root, additionalDirs: [] } as unknown as AgentSessionInfo, 'large'),
  ).rejects.toThrow('8 MiB')
})
