import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { resolveFileLink } from '../src/workspace/fileLinks'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { NO_PROJECT } from '@ramu/shared/types'

let root: string, ws: Workspace, taskId: string
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ramu-links-'))
  ws = new Workspace(openDb(':memory:'), join(root, 'worktrees'))
  taskId = (await ws.createTask({ projectId: NO_PROJECT, title: 'File links', mode: 'current' })).id
  const cwd = ws.agentScope(taskId).cwd
  mkdirSync(join(cwd, 'src'))
  writeFileSync(join(cwd, 'src', 'example file.ts'), 'export const answer = 42')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('local file links', () => {
  it('opens relative and absolute encoded paths with line and column references', async () => {
    expect(await resolveFileLink(ws, taskId, 'src/example%20file.ts#L12C3')).toEqual({
      repoId: 'general',
      path: 'src/example file.ts',
      line: 12,
      column: 3,
    })
    const cwd = ws.agentScope(taskId).cwd
    expect(await resolveFileLink(ws, taskId, `file://${cwd}/src/example%20file.ts:5:2`)).toEqual({
      repoId: 'general',
      path: 'src/example file.ts',
      line: 5,
      column: 2,
    })
    expect(localFileLink('notes.md#L8-L12')).toEqual({ path: 'notes.md', line: 8, column: 1 })
    expect(localFileLink('file:///C:/workspace/notes.md#L2')).toEqual({
      path: 'C:/workspace/notes.md',
      line: 2,
      column: 1,
    })
    expect(localFileLink('README.md:12')).toEqual({ path: 'README.md', line: 12, column: 1 })
    expect(localFileLink('README:12:3')).toEqual({ path: 'README', line: 12, column: 3 })
    expect(localFileLink('notes.md#details')).toEqual({ path: 'notes.md' })
  })
  it('leaves external URLs and anchors out of file resolution', () => {
    for (const href of [
      'https://example.com/file.ts',
      'mailto:hello@example.com',
      'javascript:alert(1)',
      'javascript:123',
      '//example.com/file',
      '#heading',
      'file://remote/path',
      'invalid%zz.md',
    ])
      expect(localFileLink(href)).toBeNull()
  })
  it('resolves folders only when asked, so chat folder links can open the Explorer', async () => {
    expect(await resolveFileLink(ws, taskId, 'src')).toBeNull()
    expect(await resolveFileLink(ws, taskId, 'src/', { folders: true })).toEqual({
      repoId: 'general',
      path: 'src',
      kind: 'folder',
    })
    expect(await resolveFileLink(ws, taskId, 'src/example%20file.ts', { folders: true })).toMatchObject({
      path: 'src/example file.ts',
    })
  })
  it('rejects missing files, folders, traversal, and links into another thread', async () => {
    const cwd = ws.agentScope(taskId).cwd
    const other = await ws.createTask({ projectId: NO_PROJECT, title: 'Other', mode: 'current' })
    const privatePath = join(ws.agentScope(other.id).cwd, 'private.txt')
    writeFileSync(privatePath, 'Another thread')
    symlinkSync(privatePath, join(cwd, 'linked.txt'))
    for (const href of ['missing.txt', 'src', privatePath, 'linked.txt', '../outside.txt'])
      expect(await resolveFileLink(ws, taskId, href)).toBeNull()
  })
})
