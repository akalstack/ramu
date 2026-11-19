import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/ipc', () => ({ copyText: vi.fn() }))
vi.mock('../src/Menu', () => ({ useContextMenu: () => ({ onContextMenu() {}, onKeyDown() {}, menu: null }) }))
import { BrowserTabChip } from '../src/views/BrowserTabChip'
const render = (faviconUrl?: string) =>
  renderToStaticMarkup(
    createElement(BrowserTabChip, {
      tab: { id: 'tab', url: 'https://www.youtube.com/watch', title: 'Video', faviconUrl } as BrowserTabInfo,
      index: 0,
      count: 1,
      active: true,
      disabled: false,
      actions: {
        select() {},
        close() {},
        closeOthers() {},
        closeToRight() {},
        duplicate() {},
        reload() {},
        openExternal() {},
        newTab() {},
      },
    }),
  )
it('shows the site favicon beside the title with a globe fallback and no duplicate accessible title', () => {
  const icon = render('https://www.youtube.com/favicon.ico')
  expect(icon).toContain('src="https://www.youtube.com/favicon.ico"')
  expect(icon).toContain('alt=""')
  expect(icon.toLowerCase()).toContain('referrerpolicy="no-referrer"')
  expect(render()).toContain('lucide-globe')
  expect(render('file:///tmp/icon.png')).not.toContain('<img')
})
