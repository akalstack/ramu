import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { SkillCopyUpdate } from '@ramu/shared/types'
const state = vi.hoisted(() => ({ confirm: () => {} }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/Menu', () => ({
  Dialog: ({ children, onConfirm }: { children: ReactNode; onConfirm: () => void }) => {
    state.confirm = onConfirm
    return createElement('div', null, children)
  },
  Dropdown: ({ label }: { label: string }) => createElement('select', { 'aria-label': label }),
}))
const { SkillCopyUpdateReview } = await import('../src/settings/SkillCopyUpdateReview')
const field = (conflict = false) => ({
  before: 'Original',
  local: 'My edits',
  source: 'Source update',
  proposed: 'My edits',
  conflict,
})
const preview = (patch: Partial<SkillCopyUpdate> = {}): SkillCopyUpdate => ({
  id: 'copy',
  revision: 2,
  sourceRevision: 3,
  sourceName: 'source',
  description: field(),
  content: field(),
  files: [],
  fileVersions: {},
  ...patch,
})

it('sends the reviewed proposal rather than overwriting local edits with the source', () => {
  const onSave = vi.fn()
  const html = renderToStaticMarkup(
    createElement(SkillCopyUpdateReview, { preview: preview(), busy: false, error: '', onCancel: vi.fn(), onSave }),
  )
  expect(html).toContain('Original version')
  expect(html).toContain('Source update')
  expect(html).toContain('My edits')
  state.confirm()
  expect(onSave).toHaveBeenCalledWith({ description: 'My edits', content: 'My edits', files: {} })
})

it('requires explicit review for conflicting text or files before saving', () => {
  for (const update of [
    preview({ content: field(true) }),
    preview({ files: [{ path: 'references/check.md', change: 'changed', conflict: true }] }),
  ]) {
    const onSave = vi.fn()
    const html = renderToStaticMarkup(
      createElement(SkillCopyUpdateReview, { preview: update, busy: false, error: '', onCancel: vi.fn(), onSave }),
    )
    expect(html).toContain(update.content.conflict ? 'Both your copy' : 'Both versions changed')
    state.confirm()
    expect(onSave).not.toHaveBeenCalled()
  }
})

it('shows bounded file comparisons as inert text and identifies unavailable versions', () => {
  const html = renderToStaticMarkup(
    createElement(SkillCopyUpdateReview, {
      preview: preview({
        files: [{ path: 'references/check.md', change: 'changed', conflict: false }],
        fileVersions: {
          'references/check.md': {
            before: null,
            local: { bytes: 10000 },
            source: { bytes: 18, text: '<script>x</script>' },
          },
        },
      }),
      busy: false,
      error: '',
      onCancel: vi.fn(),
      onSave: vi.fn(),
    }),
  )
  expect(html).toContain('File not present')
  expect(html).toContain('Content preview unavailable.')
  expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
  expect(html).not.toContain('<script>')
})

it('keeps a viewer review draft visible but disables applying it', () => {
  const onSave = vi.fn()
  const html = renderToStaticMarkup(
    createElement(SkillCopyUpdateReview, {
      preview: preview(),
      busy: false,
      readOnly: true,
      error: '',
      onCancel: vi.fn(),
      onSave,
    }),
  )
  expect(html).toContain('My edits')
  expect(html).toContain('<fieldset disabled=""')
  state.confirm()
  expect(onSave).not.toHaveBeenCalled()
})
