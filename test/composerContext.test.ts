import { expect, it, vi } from 'vitest'
import type { ViewDescriptor } from '../src/shared/types'
import { buildComposerContext } from '../src/shared/composerContext'

const file = (id: string, path = `${id}.ts`): ViewDescriptor => ({ id, kind: 'file', repoId: 'repo', path })
const selection = { content: 'unsaved selected text', selection: { startLine: 3, startColumn: 2, endLine: 4, endColumn: 6 } }
const options = () => ({ views: [file('other'), file('active')], activeViewId: 'active', explicitFiles: [], includeTabContext: true, readBuffer: vi.fn(() => 'unsaved full content'), readSelection: vi.fn(() => undefined) })

it('hydrates only the active file and sends other tabs as path references', () => {
  const args = options()
  expect(buildComposerContext(args)).toEqual([
    { repoId: 'repo', path: 'active.ts', source: 'tab', referenceOnly: false, content: 'unsaved full content' },
    { repoId: 'repo', path: 'other.ts', source: 'tab', referenceOnly: true },
  ])
  expect(args.readBuffer).toHaveBeenCalledTimes(1)
  expect(args.readSelection).toHaveBeenCalledWith('active')
})
it('uses only the selected range, without reading the full buffer', () => {
  const args = options()
  const context = buildComposerContext({ ...args, readSelection: () => selection })
  expect(context[0]).toMatchObject(selection)
  expect(args.readBuffer).not.toHaveBeenCalled()
})
it('explicit files override both inactive references and active selections', () => {
  const args = options()
  const context = buildComposerContext({ ...args, explicitFiles: [{ repoId: 'repo', path: 'other.ts' }, { repoId: 'repo', path: 'active.ts' }], readSelection: () => selection })
  expect(context).toEqual(['other.ts', 'active.ts'].map((path) => ({ repoId: 'repo', path, source: 'mention', content: 'unsaved full content' })))
})
it('keeps explicit content when automatic tab context is disabled', () => {
  expect(buildComposerContext({ ...options(), includeTabContext: false, explicitFiles: [{ repoId: 'repo', path: 'other.ts' }] })).toEqual([
    { repoId: 'repo', path: 'other.ts', source: 'mention', content: 'unsaved full content' },
  ])
})
it('sends only references when a chat or terminal is active', () => {
  const args = options()
  expect(buildComposerContext({ ...args, activeViewId: 'chat' }).every((entry) => entry.referenceOnly)).toBe(true)
  expect(args.readBuffer).not.toHaveBeenCalled()
})
it('preserves active diff metadata and lets explicit mentions request the file itself', () => {
  const views: ViewDescriptor[] = [file('other', 'same.ts'), { id: 'diff', kind: 'diff', repoId: 'repo', path: 'same.ts', staged: true }]
  expect(buildComposerContext({ ...options(), views, activeViewId: 'diff', readSelection: () => ({ ...selection, selection: { ...selection.selection, side: 'original' } }) })).toEqual([
    { repoId: 'repo', path: 'same.ts', source: 'tab', referenceOnly: false, diff: { staged: true, oid: undefined }, content: selection.content, selection: { ...selection.selection, side: 'original' } },
  ])
  const explicit = buildComposerContext({ ...options(), views, activeViewId: 'diff', explicitFiles: [{ repoId: 'repo', path: 'same.ts' }] })
  expect(explicit[0]?.diff).toBeUndefined()
  expect(explicit[0]?.source).toBe('mention')
})
it('prioritizes mentions and the active file before applying the 30-file limit', () => {
  const args = options()
  const context = buildComposerContext({ ...args, views: Array.from({ length: 40 }, (_, i) => file(String(i))), activeViewId: '39', explicitFiles: [{ repoId: 'repo', path: 'explicit.ts' }] })
  expect(context).toHaveLength(30)
  expect(context.slice(0, 2).map((entry) => entry.path)).toEqual(['explicit.ts', '39.ts'])
  expect(args.readBuffer).toHaveBeenCalledTimes(2)
})
