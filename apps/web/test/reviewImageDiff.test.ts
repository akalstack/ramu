import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { ChangeFile } from '@ramu/shared/types'

vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: () => new Promise(() => {}) }) }))
const { ReviewBinaryNote, ReviewImageDiff } = await import('../src/changes/ReviewImageDiff')

const file: ChangeFile = {
  id: 'f',
  repoId: 'r',
  repoName: 'repo',
  path: 'docs/diagram.png',
  status: 'modified',
  binary: true,
  oldContent: '',
  newContent: '',
  oldSize: 2048,
  newSize: 4096,
}

it('says how a binary file without a preview changed size', () => {
  const html = renderToStaticMarkup(createElement(ReviewBinaryNote, { file: { ...file, path: 'app.bin' } }))
  expect(html).toContain('This binary or large file has no text diff.')
  expect(html).toMatch(/2(\.0)?\s?(kB|KB).*4(\.0)?\s?(kB|KB)/)
})

it('waits for the host before showing a changed picture', () => {
  expect(renderToStaticMarkup(createElement(ReviewImageDiff, { reviewId: 'v', file }))).toContain('Loading image…')
})
