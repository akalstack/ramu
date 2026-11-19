import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { initialMarkdownView, MarkdownViewControl } from '../src/editor/MarkdownViewControl'
import { resetSection } from '../src/settings/resetDefaults'

vi.mock('../src/i18n', () => ({ t: (text: string) => text }))

it('opens ordinary Markdown files in Preview by default, including older preferences', () => {
  expect(initialMarkdownView(DEFAULT_APP_PREFERENCES.defaultMarkdownView, false)).toBe('preview')
  expect(initialMarkdownView(undefined, false)).toBe('preview')
})

it.each(['source', 'edit', 'preview'] as const)('respects %s while revealing line links in Source', (mode) => {
  expect(initialMarkdownView(mode, false)).toBe(mode)
  expect(initialMarkdownView(mode, true)).toBe('source')
})

it('labels the three modes and keeps the current mode when its toggle is deselected', () => {
  const onChange = vi.fn()
  const html = renderToStaticMarkup(createElement(MarkdownViewControl, { mode: 'preview', onChange }))
  for (const label of ['Source', 'Edit', 'Preview']) expect(html).toContain(`aria-label="${label}"`)
  const control = MarkdownViewControl({ mode: 'preview', onChange })
  control.props.onValueChange([])
  expect(onChange).not.toHaveBeenCalled()
  control.props.onValueChange(['edit'])
  expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
})

it('restores Preview through the Editor section reset without changing other preferences', () => {
  const next = resetSection({ ...DEFAULT_APP_PREFERENCES, defaultMarkdownView: 'source', fontSize: 16 }, 'editor')
  expect(next.defaultMarkdownView).toBe('preview')
  expect(next.fontSize).toBe(16)
})
