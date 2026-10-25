import { describe, expect, it } from 'vitest'
import { fileToolDiffs, fileToolLine, lineChanges } from '../src/chat/fileTools'

describe('fileToolLine', () => {
  it('names only the file for a Claude read and leaves counts out', () => {
    expect(
      fileToolLine({
        name: 'Read',
        summary: '/repo/src/auth/session.ts',
        input: '{"file_path":"/repo/src/auth/session.ts"}',
      }),
    ).toEqual({ verb: 'Read', path: '/repo/src/auth/session.ts', name: 'session.ts', others: 0 })
  })

  it('counts added and removed lines for Claude Edit, MultiEdit and Write inputs', () => {
    const edit = fileToolLine({
      name: 'Edit',
      summary: 'src/a.ts',
      input: JSON.stringify({
        file_path: 'src/a.ts',
        old_string: 'one\ntwo\nthree',
        new_string: 'one\n2\nthree\nfour',
      }),
    })
    expect(edit).toMatchObject({ verb: 'Edited', name: 'a.ts', added: 2, removed: 1 })
    const multi = fileToolLine({
      name: 'MultiEdit',
      summary: 'b.ts',
      input: JSON.stringify({
        file_path: 'b.ts',
        edits: [
          { old_string: 'x', new_string: 'y' },
          { old_string: 'gone', new_string: '' },
        ],
      }),
    })
    expect(multi).toMatchObject({ added: 1, removed: 2 })
    expect(
      fileToolLine({ name: 'Write', summary: 'c.md', input: JSON.stringify({ file_path: 'c.md', content: 'a\nb\n' }) }),
    ).toMatchObject({ verb: 'Wrote', name: 'c.md', added: 2 })
  })

  it('uses ACP and Codex diff content, including the result, and reports further files', () => {
    const line = fileToolLine(
      { name: 'apply_patch', toolKind: 'edit', summary: 'src/x.ts, src/y.ts' },
      {
        content: [
          { type: 'diff', path: 'src/x.ts', oldText: 'a\nb', newText: 'a\nc' },
          { type: 'diff', path: 'src/y.ts', oldText: null, newText: 'new\nfile' },
        ],
      },
    )
    expect(line).toEqual({ verb: 'Edited', path: 'src/x.ts', name: 'x.ts', others: 1, added: 3, removed: 1 })
  })

  it('falls back to the summary path and ignores other tools', () => {
    expect(fileToolLine({ name: 'Read', toolKind: 'read', summary: 'docs/guide/README.md:12' })).toMatchObject({
      name: 'README.md',
    })
    expect(fileToolLine({ name: 'Bash', summary: 'ls' })).toBeNull()
    expect(fileToolLine({ name: 'Read', summary: '{"weird":1}' })).toBeNull()
  })
})

describe('lineChanges', () => {
  it('skips shared lines and counts a large rewrite without comparing every pair', () => {
    expect(lineChanges('a\nb\nc', 'a\nx\nc')).toEqual({ added: 1, removed: 1 })
    expect(lineChanges(null, 'one\ntwo')).toEqual({ added: 2, removed: 0 })
    const big = Array.from({ length: 1000 }, (_, i) => `l${i}`).join('\n')
    expect(lineChanges(big, big.replace(/l/g, 'm'))).toEqual({ added: 1000, removed: 1000 })
  })
})

describe('fileToolDiffs', () => {
  it('builds diffs from Claude inputs and prefers provider diff content', () => {
    expect(
      fileToolDiffs({
        name: 'Edit',
        summary: 'a.ts',
        input: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }),
      }),
    ).toEqual([{ type: 'diff', path: 'a.ts', oldText: 'x', newText: 'y' }])
    const given = { type: 'diff' as const, path: 'b.ts', oldText: null, newText: 'z' }
    expect(fileToolDiffs({ name: 'apply_patch', toolKind: 'edit', summary: 'b.ts' }, { content: [given] })).toEqual([
      given,
    ])
    expect(fileToolDiffs({ name: 'Read', summary: 'a.ts' })).toEqual([])
  })
})
