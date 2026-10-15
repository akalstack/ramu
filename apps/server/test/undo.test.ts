import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { RunUndo } from '../src/undo'
import type { ChangeFile } from '@ramu/shared/types'
let dir: string, cwd: string, undo: RunUndo
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-undo-')))
  cwd = join(dir, 'work')
  mkdirSync(cwd)
  undo = new RunUndo(join(dir, 'backups'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const file = (extra: Partial<ChangeFile> = {}): ChangeFile => ({
  id: 'file',
  repoId: 'repo',
  repoName: 'Demo',
  path: 'notes.txt',
  status: 'modified',
  binary: false,
  oldContent: 'Original\n',
  newContent: 'Agent\n',
  ...extra,
})
const preview = (files: ChangeFile[]) => undo.preview('run', files, [{ repoId: 'repo', cwd }])
it('undoes only the run and keeps pre-existing edits in its baseline', async () => {
  writeFileSync(join(cwd, 'notes.txt'), 'User pre-existing edit\nAgent\n')
  const plan = await preview([
    file({ oldContent: 'User pre-existing edit\nOriginal\n', newContent: 'User pre-existing edit\nAgent\n' }),
  ])
  expect(plan.files[0]?.status).toBe('ready')
  await undo.apply(plan.token, ['file'])
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('User pre-existing edit\nOriginal\n')
  await expect(undo.apply(plan.token, ['file'])).rejects.toThrow('expired')
})
it('three-way undo preserves separate edits made after the agent run', async () => {
  const lines = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  const before = lines.join('\n') + '\n',
    after = ['AGENT', ...lines.slice(1)].join('\n') + '\n'
  writeFileSync(join(cwd, 'notes.txt'), after.replace('ten', 'LATER USER EDIT'))
  const plan = await preview([file({ oldContent: before, newContent: after })])
  expect(plan.files[0]?.status).toBe('ready')
  expect(plan.files[0]?.reason).toContain('preserving later edits')
  await undo.apply(plan.token, ['file'])
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe(before.replace('ten', 'LATER USER EDIT'))
})
it('refuses overlapping later edits without changing any file', async () => {
  writeFileSync(join(cwd, 'notes.txt'), 'Later user version\n')
  const plan = await preview([file()])
  expect(plan.files[0]?.status).toBe('conflict')
  await expect(undo.apply(plan.token, ['file'])).rejects.toThrow('ready')
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('Later user version\n')
})
it('checks the entire selection and refuses stale previews before writing', async () => {
  writeFileSync(join(cwd, 'notes.txt'), 'Agent\n')
  writeFileSync(join(cwd, 'second.txt'), 'Agent\n')
  const plan = await preview([file(), file({ id: 'second', path: 'second.txt' })])
  writeFileSync(join(cwd, 'second.txt'), 'Changed after preview\n')
  await expect(undo.apply(plan.token, ['file', 'second'])).rejects.toThrow('changed after preview')
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('Agent\n')
  expect(readFileSync(join(cwd, 'second.txt'), 'utf8')).toBe('Changed after preview\n')
})
it('removes unchanged added files and restores deleted files with original permissions', async () => {
  writeFileSync(join(cwd, 'new.txt'), 'Added\n')
  const plan = await preview([
    file({ path: 'new.txt', status: 'added', oldContent: '', newContent: 'Added\n' }),
    file({
      id: 'deleted',
      path: 'tool.sh',
      status: 'deleted',
      oldContent: '#!/bin/sh\necho hi\n',
      newContent: '',
      oldMode: 0o755,
    }),
  ])
  await undo.apply(plan.token, ['file', 'deleted'])
  expect(existsSync(join(cwd, 'new.txt'))).toBe(false)
  expect(statSync(join(cwd, 'tool.sh')).mode & 0o777).toBe(0o755)
})
it('keeps later edits to an added file and a replacement for a deleted file', async () => {
  writeFileSync(join(cwd, 'new.txt'), 'Agent plus later edit\n')
  writeFileSync(join(cwd, 'deleted.txt'), 'New replacement\n')
  const plan = await preview([
    file({ path: 'new.txt', status: 'added', oldContent: '' }),
    file({ id: 'deleted', path: 'deleted.txt', status: 'deleted', newContent: '' }),
  ])
  expect(plan.files.map((f) => f.status)).toEqual(['conflict', 'conflict'])
})
it('blocks traversal, binary files, and symlink replacements', async () => {
  writeFileSync(join(dir, 'outside.txt'), 'Agent\n')
  symlinkSync(join(dir, 'outside.txt'), join(cwd, 'notes.txt'))
  const plan = await preview([
    file(),
    file({ id: 'escape', path: '../outside.txt' }),
    file({ id: 'binary', path: 'image.png', binary: true }),
  ])
  expect(plan.files.every((f) => f.status === 'unavailable')).toBe(true)
  await expect(undo.apply(plan.token, ['file'])).rejects.toThrow('ready')
  expect(readFileSync(join(dir, 'outside.txt'), 'utf8')).toBe('Agent\n')
})
it('does not expose private filesystem locations in the preview', async () => {
  writeFileSync(join(cwd, 'notes.txt'), 'Agent\n')
  const plan = await preview([file()])
  expect(JSON.stringify(plan)).not.toContain(cwd)
  expect(plan.files[0]).not.toHaveProperty('expected')
})

it('reports interrupted recovery journals without changing current files', async () => {
  writeFileSync(join(cwd, 'notes.txt'), 'Later user content\n')
  const folder = join(dir, 'interrupted')
  mkdirSync(join(folder, 'run'), { recursive: true })
  writeFileSync(
    join(folder, 'run', 'journal.json'),
    JSON.stringify({ state: 'applying', reviewId: 'review', files: [] }),
  )
  const recovery = new RunUndo(folder).interrupted()
  expect(recovery).toEqual([{ reviewId: 'review', backup: join(folder, 'run', 'journal.json') }])
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('Later user content\n')
})
