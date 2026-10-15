import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { describeDroppedPaths, importEntries } from '../src/files'

let lab: string, root: string, outside: string
beforeEach(() => {
  lab = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-drops-')))
  root = join(lab, 'repo')
  outside = join(lab, 'desktop')
  mkdirSync(root)
  mkdirSync(outside)
})
afterEach(() => rmSync(lab, { recursive: true, force: true }))

it('distinguishes empty desktop folders from files', async () => {
  const folder = join(outside, 'empty'),
    file = join(outside, 'empty.txt')
  mkdirSync(folder)
  writeFileSync(file, '')
  expect(await describeDroppedPaths([folder, file])).toEqual([
    { path: folder, kind: 'dir' },
    { path: file, kind: 'file' },
  ])
})

it('imports multiple files and recursive folders without moving or overwriting originals', async () => {
  mkdirSync(join(root, 'target'))
  mkdirSync(join(outside, 'folder'))
  writeFileSync(join(outside, 'folder', 'nested.txt'), 'nested')
  writeFileSync(join(outside, 'notes.txt'), 'new')
  writeFileSync(join(root, 'target', 'notes.txt'), 'existing')
  expect(await importEntries(root, 'target', [join(outside, 'notes.txt'), join(outside, 'folder')])).toEqual([
    'target/notes copy.txt',
    'target/folder',
  ])
  expect(readFileSync(join(root, 'target', 'notes.txt'), 'utf8')).toBe('existing')
  expect(readFileSync(join(root, 'target', 'notes copy.txt'), 'utf8')).toBe('new')
  expect(readFileSync(join(root, 'target', 'folder', 'nested.txt'), 'utf8')).toBe('nested')
  expect(readFileSync(join(outside, 'folder', 'nested.txt'), 'utf8')).toBe('nested')
  expect(await importEntries(root, 'target', [join(outside, 'notes.txt'), join(outside, 'notes.txt')])).toEqual([
    'target/notes copy 2.txt',
  ])
})

it('rejects escaped, symlinked and .git destinations and copying a folder into itself', async () => {
  const file = join(outside, 'notes.txt')
  writeFileSync(file, 'private')
  symlinkSync(outside, join(root, 'escape'))
  await expect(importEntries(root, '../desktop', [file])).rejects.toThrow('outside')
  await expect(importEntries(root, 'escape', [file])).rejects.toThrow('outside')
  await expect(importEntries(root, '.git', [file])).rejects.toThrow('.git')
  await expect(importEntries(root, '', [root])).rejects.toThrow('into itself')
  await expect(importEntries(root, '', ['relative.txt'])).rejects.toThrow('absolute')
})

it('allows copying between repositories and rejects unsupported sources', async () => {
  const file = join(outside, 'notes.txt')
  writeFileSync(file, 'source repo')
  expect(await importEntries(root, '', [file])).toEqual(['notes.txt'])
  await expect(describeDroppedPaths(['notes.txt'])).rejects.toThrow('absolute')
  await expect(importEntries(root, '', [join(outside, 'missing')])).rejects.toThrow()
})
