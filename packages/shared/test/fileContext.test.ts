import { expect, it } from 'vitest'
import { fileContextKey } from '../src/chat/fileContext'

it('keeps repository, diff and captured-selection variants distinct inside a composer', () => {
  const file = { repoId: 'repo', path: 'src/index.ts' }
  const identities = [
    file,
    { ...file, repoId: 'other' },
    { ...file, diff: { staged: false as const } },
    { ...file, diff: { staged: true as const } },
    { ...file, diff: { staged: 'all' as const } },
    { ...file, diff: { staged: 'all' as const, oid: 'commit' } },
    { ...file, selection: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 } },
    { ...file, selection: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 1 } },
  ].map(fileContextKey)
  expect(new Set(identities).size).toBe(identities.length)
  expect(fileContextKey({ ...file })).toBe(fileContextKey(file))
})
