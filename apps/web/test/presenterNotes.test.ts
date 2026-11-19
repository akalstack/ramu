import { expect, it, vi } from 'vitest'

vi.mock('../src/i18n', () => ({
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? '')),
}))

function fakeWindow() {
  const children: { textContent: string; style: { cssText: string } }[] = []
  const body = {
    style: { cssText: '', setProperty: vi.fn() },
    replaceChildren: () => void children.splice(0),
    append: (child: (typeof children)[number]) => void children.push(child),
  }
  const document = { title: '', body, createElement: () => ({ textContent: '', style: { cssText: '' } }) }
  return { win: { closed: false, document } as unknown as Window, children }
}

it('shows where the presenter is, the slide’s notes as text and what comes next', async () => {
  const { showPresenterSlide } = await import('../src/pages/PresenterNotes')
  const { win, children } = fakeWindow()
  const since = Date.now() - 65_000
  showPresenterSlide(
    win,
    { index: 1, count: 6, title: 'The problem', notes: '<b>Pause</b> here', next: 'Our answer' },
    since,
    { '--background': '#000' },
  )
  expect(children.map((child) => child.textContent)).toEqual([
    '2 of 6 · 1:05',
    'The problem',
    '<b>Pause</b> here',
    'Next: Our answer',
  ])
  showPresenterSlide(win, { index: 5, count: 6, title: 'Thanks', notes: '', next: null }, since, {})
  expect(children.map((child) => child.textContent).slice(1)).toEqual(['Thanks', 'No speaker notes on this slide.'])
})
