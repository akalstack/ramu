import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { HideWorkspaceButton } from '../src/workspace/HideWorkspaceButton'

vi.mock('../src/i18n', () => ({ t: (text: string) => text }))

it('exposes a labelled hide action and runs it when clicked', () => {
  const onHide = vi.fn()
  const html = renderToStaticMarkup(createElement(HideWorkspaceButton, { onHide }))
  expect(html).toContain('aria-label="Hide workspace"')
  expect(html).toContain('title="Hide workspace"')
  expect(html).toContain('text-muted-foreground')
  expect(html).toContain('hover:text-foreground')
  HideWorkspaceButton({ onHide }).props.onClick()
  expect(onHide).toHaveBeenCalledOnce()
})
