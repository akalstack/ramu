import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { TransferManifest } from '@ramu/shared/types'
import { TRANSFER_CHUNK_BYTES, TransferInbox, readTransferChunk, transferManifest } from '../src/workspace/transfer'

let lab: string, from: string, to: string
beforeEach(() => {
  lab = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-transfer-test-')))
  from = join(lab, 'from')
  to = join(lab, 'to')
  mkdirSync(from)
  mkdirSync(to)
})
afterEach(() => rmSync(lab, { recursive: true, force: true }))

/** What the app does between two hosts: read every chunk from one side and write it to the other. */
async function copy(roots: string[], inbox: TransferInbox, manifest?: TransferManifest) {
  const id = await inbox.begin()
  for (const entry of (manifest ?? (await transferManifest(roots))).entries) {
    if (entry.kind !== 'file') {
      await inbox.write(id, { ...entry, offset: 0, data: '', gzip: false })
      continue
    }
    let offset = 0
    do {
      const chunk = await readTransferChunk(roots[entry.root]!, entry.path, offset)
      await inbox.write(id, { ...entry, offset, data: chunk.data, gzip: chunk.gzip })
      offset += chunk.bytes
    } while (offset < entry.size)
  }
  return id
}

it('copies folders, empty files, links and executable bits between hosts under free names', async () => {
  mkdirSync(join(from, 'tool', '.git'), { recursive: true })
  writeFileSync(join(from, 'tool', '.git', 'HEAD'), 'ref')
  writeFileSync(join(from, 'tool', 'run.sh'), '#!/bin/sh\necho hi\n')
  chmodSync(join(from, 'tool', 'run.sh'), 0o755)
  writeFileSync(join(from, 'tool', 'empty.txt'), '')
  symlinkSync('run.sh', join(from, 'tool', 'latest'))
  writeFileSync(join(from, 'notes.txt'), 'new')
  writeFileSync(join(to, 'notes.txt'), 'existing')

  const manifest = await transferManifest([join(from, 'tool'), join(from, 'notes.txt')])
  expect(manifest.entries.map((entry) => entry.path)).not.toContain('tool/.git')
  const inbox = new TransferInbox()
  const id = await copy([join(from, 'tool'), join(from, 'notes.txt')], inbox, manifest)
  expect(await inbox.finish(id, to, '')).toEqual(['tool', 'notes copy.txt'])

  expect(readFileSync(join(to, 'tool', 'run.sh'), 'utf8')).toBe('#!/bin/sh\necho hi\n')
  expect(statSync(join(to, 'tool', 'run.sh')).mode & 0o111).toBe(0o111)
  expect(readFileSync(join(to, 'tool', 'empty.txt'), 'utf8')).toBe('')
  expect(readFileSync(join(to, 'tool', 'latest'), 'utf8')).toContain('echo hi')
  expect(readFileSync(join(to, 'notes.txt'), 'utf8')).toBe('existing')
  expect(readFileSync(join(to, 'notes copy.txt'), 'utf8')).toBe('new')
  // The staging folder is gone once the copy lands.
  await expect(
    inbox.write(id, { root: 0, path: 'x', kind: 'dir', mode: 0o755, offset: 0, data: '', gzip: false }),
  ).rejects.toThrow('expired')
})

it('gzips text in chunks and sends already-compressed formats as they are', async () => {
  const text = 'line of repeated text\n'.repeat(Math.ceil((TRANSFER_CHUNK_BYTES * 1.5) / 22))
  writeFileSync(join(from, 'big.log'), text)
  writeFileSync(join(from, 'photo.png'), Buffer.alloc(4096, 7))
  const first = await readTransferChunk(join(from, 'big.log'), 'big.log', 0)
  expect(first.gzip).toBe(true)
  expect(first.bytes).toBe(TRANSFER_CHUNK_BYTES)
  expect(first.data.length).toBeLessThan(TRANSFER_CHUNK_BYTES / 10)
  expect((await readTransferChunk(join(from, 'photo.png'), 'photo.png', 0)).gzip).toBe(false)

  const inbox = new TransferInbox()
  const id = await copy([join(from, 'big.log')], inbox)
  await inbox.finish(id, to, '')
  expect(readFileSync(join(to, 'big.log'), 'utf8')).toBe(text)
})

it('reads only what the chosen item contains, even through links', async () => {
  mkdirSync(join(from, 'folder'))
  writeFileSync(join(lab, 'secret.txt'), 'private')
  symlinkSync(lab, join(from, 'folder', 'out'))
  const root = join(from, 'folder')
  await expect(readTransferChunk(root, 'folder/../../secret.txt', 0)).rejects.toThrow('not part')
  await expect(readTransferChunk(root, 'other/secret.txt', 0)).rejects.toThrow('not part')
  await expect(readTransferChunk(root, 'folder/out/secret.txt', 0)).rejects.toThrow('not part')
})

it('refuses writes outside the staging folder and chunks out of order, and cancels cleanly', async () => {
  const inbox = new TransferInbox()
  const id = await inbox.begin()
  const write = { root: 0, kind: 'file' as const, mode: 0o644, gzip: false }
  await expect(inbox.write(id, { ...write, path: '../../escape.txt', offset: 0, data: '' })).rejects.toThrow()
  await inbox.write(id, { ...write, path: 'a.txt', offset: 0, data: Buffer.from('abc').toString('base64') })
  await expect(
    inbox.write(id, { ...write, path: 'a.txt', offset: 10, data: Buffer.from('d').toString('base64') }),
  ).rejects.toThrow('out of order')
  await inbox.cancel(id)
  await expect(inbox.finish(id, to, '')).rejects.toThrow('expired')
  expect(await readdir(to)).toEqual([])
})

it('drops abandoned copies after an hour without writes', async () => {
  let now = 0
  const inbox = new TransferInbox(() => now)
  const id = await inbox.begin()
  now = 61 * 60 * 1000
  await inbox.begin()
  await expect(inbox.finish(id, to, '')).rejects.toThrow('expired')
})
