import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { ScrollToLatestButton } from '../src/views/agent/components/ScrollToLatestButton'
const state = vi.hoisted(() => ({ reduced: false, props: {} as Record<string, unknown> }))
vi.mock('../src/i18n', () => ({ useLanguage: () => {}, t: (text: string) => text }))
vi.mock('../src/workspace/panelMotion', () => ({ reducedMotion: () => state.reduced }))
vi.mock('@/components/ui/message-scroller', () => ({
  MessageScrollerButton: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
    state.props = props
    return createElement('button', { 'aria-label': props['aria-label'] as string }, children)
  },
}))
afterEach(() => {
  state.reduced = false
})
it('uses smooth scrolling and a labelled arrow while idle', () => {
  const html = renderToStaticMarkup(createElement(ScrollToLatestButton, { working: false }))
  expect(state.props.behavior).toBe('smooth')
  expect(html).toContain('aria-label="Scroll to latest"')
  expect(html).toContain('<svg')
})
it('keeps the scroll action labelled while showing activity in the same inherited color', () => {
  const html = renderToStaticMarkup(createElement(ScrollToLatestButton, { working: true }))
  expect(state.props['aria-label']).toBe('Agent is working. Scroll to latest')
  expect(html.match(/<i/g)).toHaveLength(3)
  expect(html).toContain('bg-current')
  expect(html).not.toContain('opacity-60')
})
it('disables smooth scrolling when reduced motion is requested', () => {
  state.reduced = true
  renderToStaticMarkup(createElement(ScrollToLatestButton, { working: false }))
  expect(state.props.behavior).toBe('auto')
})
