import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { Attachment } from '@ramu/shared/types'

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect() {},
  useRef: (initial: unknown) => ({ current: initial }),
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key])),
}))
vi.mock('../src/ipc', () => ({ invoke: vi.fn() }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: vi.fn(), isLocal: false }) }))
vi.mock('../src/chat/Notifications', () => ({ notifyError() {} }))
import { Attachments } from '../src/composer/Attachments'

const file: Attachment = {
  id: 'image',
  path: '/attachments/image',
  name: 'Screenshot.png',
  mimeType: 'image/png',
  size: 1024,
}
it.each(['normal', 'small'] as const)('labels the %s attachment preview and remove actions independently', (size) => {
  const html = renderToStaticMarkup(createElement(Attachments, { files: [file], size, onRemove() {} }))
  expect(html).toContain('aria-label="Preview Screenshot.png"')
  expect(html).toContain('aria-label="Remove attachment Screenshot.png"')
  expect(html).toContain('aria-haspopup="dialog"')
})
it('does not offer removal on a sent attachment', () => {
  const html = renderToStaticMarkup(createElement(Attachments, { files: [file] }))
  expect(html).not.toContain('Remove attachment')
  expect(html).toContain('Preview Screenshot.png')
})
it('removes only the requested file and stops the preview click from bubbling', () => {
  const onRemove = vi.fn()
  const group = Attachments({ files: [file], onRemove })
  const itemElement = group.props.children[0][0]
  const item = itemElement.type(itemElement.props)
  function find(node: ReactNode): Record<string, unknown> | undefined {
    if (Array.isArray(node)) return node.map(find).find(Boolean)
    if (!isValidElement<Record<string, unknown>>(node)) return
    if (String(node.props['aria-label']).startsWith('Remove attachment')) return node.props
    return find(node.props.children as ReactNode)
  }
  const remove = find(item)!
  const stopPropagation = vi.fn()
  ;(remove.onClick as (event: unknown) => void)({ stopPropagation })
  expect(stopPropagation).toHaveBeenCalledOnce()
  expect(onRemove).toHaveBeenCalledExactlyOnceWith('image')
})
