import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ScrollToLatestButton } from '../src/views/agent/components/ScrollToLatestButton'
const state = vi.hoisted(() => ({ props: {} as Record<string, unknown> }))
vi.mock('../src/i18n', () => ({ useLanguage: () => {}, t: (text: string) => text }))
vi.mock('@/components/desktop-button', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
    state.props = props
    return createElement('button', { 'aria-label': props['aria-label'] as string }, children)
  },
}))
const render = (props: { working: boolean; active: boolean; onClick?: () => void }) =>
  renderToStaticMarkup(createElement(ScrollToLatestButton, { onClick: () => {}, ...props }))

it('shows a labelled arrow while idle and away from the end', () => {
  const html = render({ working: false, active: true })
  expect(html).toContain('aria-label="Scroll to latest"')
  expect(html).toContain('<svg')
  expect(state.props['data-active']).toBe(true)
  expect(state.props.inert).toBe(false)
})
it('keeps the scroll action labelled while showing activity in the same inherited color', () => {
  const html = render({ working: true, active: true })
  expect(state.props['aria-label']).toBe('Agent is working. Scroll to latest')
  expect(html.match(/<i/g)).toHaveLength(3)
  expect(html).toContain('bg-current')
  expect(html).not.toContain('opacity-60')
})
it('cannot be reached while the reader is at the end', () => {
  render({ working: false, active: false })
  expect(state.props['data-active']).toBe(false)
  expect(state.props.inert).toBe(true)
  expect(state.props.tabIndex).toBe(-1)
})
it('lets go of focus and scrolls when pressed', () => {
  const onClick = vi.fn()
  const blur = vi.fn()
  render({ working: false, active: true, onClick })
  ;(state.props.onClick as (event: { currentTarget: { blur: () => void } }) => void)({ currentTarget: { blur } })
  expect(blur).toHaveBeenCalled()
  expect(onClick).toHaveBeenCalled()
})
