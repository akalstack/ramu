import { describe, expect, it } from 'vitest'
import { composerDraft } from '../src/chat/composerDraft'
import { draftChip, fileChip, isFolderLike, skillChip } from '../src/chat/referenceChip'

describe('referenceChip', () => {
  it('names a file by its last path part and keeps the line', () => {
    expect(fileChip('apps/web/src/App.tsx')).toMatchObject({
      kind: 'file',
      label: 'App.tsx',
      title: 'apps/web/src/App.tsx',
    })
    expect(fileChip('src/auth/reset.ts:42:7')).toMatchObject({ label: 'reset.ts:42', line: 42, column: 7 })
  })

  it('treats paths without an extension as folders, except well-known files', () => {
    expect(isFolderLike('apps/web')).toBe(true)
    expect(isFolderLike('src/')).toBe(true)
    expect(isFolderLike('README')).toBe(false)
    expect(isFolderLike('docs/Dockerfile')).toBe(false)
    expect(fileChip('apps/web/')).toMatchObject({ kind: 'folder', label: 'web' })
  })

  it('keeps the words a link author chose', () => {
    expect(fileChip('src/a.ts', 'the entry point')?.label).toBe('the entry point')
  })

  it('is null for things that are not local paths', () => {
    expect(fileChip('https://example.com/a.ts')).toBeNull()
  })

  it('makes chips from composer segments', () => {
    const chips = composerDraft('see @src/a.ts and $review now ').chips.map(draftChip)
    expect(chips).toEqual([{ kind: 'file', label: 'a.ts', title: 'src/a.ts', target: 'src/a.ts' }, skillChip('review')])
    expect(draftChip({ kind: 'quote', label: 'one\n  two' }).label).toBe('one two')
  })
})
