import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
const h = vi.hoisted(() => ({
  cursor: 0,
  refs: [] as { current: unknown }[],
  cleanups: [] as (() => void)[],
  menus: [] as { key: string; disabled?: boolean; onSelect?(): void }[][],
  copy: vi.fn(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (value: unknown) => (h.refs[h.cursor++] ??= { current: value }),
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: (run: () => () => void) => {
    h.cleanups.push(run())
  },
}))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage() {} }))
vi.mock('../src/ipc', () => ({ copyText: h.copy }))
vi.mock('../src/Menu', () => ({
  useContextMenu: (_label: string, items: (typeof h.menus)[number]) => {
    h.menus.push(items)
    return { menu: null, onContextMenu() {}, onKeyDown() {} }
  },
}))
import { BrowserTabChip, type BrowserTabActions } from '../src/views/BrowserTabChip'
const tab = {
  id: 'tab',
  hostId: 'host',
  threadId: 'thread',
  title: 'Page',
  url: 'https://example.com',
  inputReady: true,
} as BrowserTabInfo
const actions = Object.fromEntries(
  ['select', 'close', 'closeOthers', 'closeToRight', 'duplicate', 'reload', 'openExternal', 'newTab'].map((key) => [
    key,
    vi.fn(),
  ]),
) as unknown as BrowserTabActions
function RenderTab(disabled = false, value = tab) {
  h.cursor = 0
  return BrowserTabChip({ tab: value, index: 0, count: 2, active: true, disabled, actions })
}
const item = (key: string) => h.menus.at(-1)!.find((entry) => entry.key === key)!
beforeEach(() => {
  h.refs = []
  h.cleanups = []
  h.menus = []
  vi.clearAllMocks()
  h.copy.mockResolvedValue(undefined)
})
it('refuses retained menu and middle-click actions while busy, preserving local address copy', () => {
  const first = RenderTab()
  const close = item('close').onSelect!,
    copy = item('copy').onSelect!
  RenderTab(true)
  close()
  first.props.onAuxClick({ button: 1, preventDefault() {} })
  expect(actions.close).not.toHaveBeenCalled()
  expect(item('new').disabled).toBe(true)
  expect(item('duplicate').disabled).toBe(true)
  copy()
  expect(h.copy).toHaveBeenCalledWith(tab.url)
  RenderTab(false)
  close()
  expect(actions.close).toHaveBeenCalledWith(tab)
})
it('guards current readiness and originating host identity, including after unmount', () => {
  RenderTab()
  const reload = item('reload').onSelect!,
    close = item('close').onSelect!
  RenderTab(false, { ...tab, inputReady: false })
  reload()
  expect(actions.reload).not.toHaveBeenCalled()
  const next = { ...tab, hostId: 'another-host' }
  RenderTab(false, next)
  close()
  expect(actions.close).not.toHaveBeenCalled()
  const currentClose = item('close').onSelect!
  currentClose()
  expect(actions.close).toHaveBeenCalledWith(next)
  for (const cleanup of h.cleanups) cleanup()
  vi.mocked(actions.close).mockClear()
  currentClose()
  expect(actions.close).not.toHaveBeenCalled()
})
