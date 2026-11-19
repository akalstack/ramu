import { expect, it, vi } from 'vitest'
import type { KeyboardEvent } from 'react'
import { navigateBrowserTabs } from '../src/components/browser-tab-controls'
it('wraps through enabled tabs and supports Home/End without activating a disabled or inert tab', () => {
  const root = { querySelectorAll: () => tabs }
  const make = (disabled = false, inert = false) => ({
    disabled,
    getAttribute: () => null,
    closest: (selector: string) => (selector.includes('tablist') ? root : inert ? {} : null),
    focus: vi.fn(),
    click: vi.fn(),
  })
  const first = make(),
    blocked = make(true),
    hidden = make(false, true),
    last = make()
  const tabs = [first, blocked, hidden, last]
  const press = (key: string, current = first) => {
    const preventDefault = vi.fn()
    navigateBrowserTabs({ key, currentTarget: current, preventDefault } as unknown as KeyboardEvent<HTMLButtonElement>)
    return preventDefault
  }
  expect(press('ArrowLeft')).toHaveBeenCalledOnce()
  expect(last.focus).toHaveBeenCalledOnce()
  expect(last.click).toHaveBeenCalledOnce()
  press('ArrowRight', last)
  expect(first.click).toHaveBeenCalledOnce()
  press('Home', last)
  press('End')
  expect(first.click).toHaveBeenCalledTimes(2)
  expect(last.click).toHaveBeenCalledTimes(2)
  expect(blocked.click).not.toHaveBeenCalled()
  expect(hidden.click).not.toHaveBeenCalled()
})

it('preserves caller cancellation and modified shortcuts instead of consuming them as tab navigation', () => {
  const closest = vi.fn(),
    preventDefault = vi.fn()
  for (const flags of [
    { defaultPrevented: true },
    { baseUIHandlerPrevented: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ]) {
    navigateBrowserTabs({
      key: 'ArrowRight',
      currentTarget: { closest },
      preventDefault,
      ...flags,
    } as unknown as KeyboardEvent<HTMLButtonElement>)
  }
  expect(closest).not.toHaveBeenCalled()
  expect(preventDefault).not.toHaveBeenCalled()
})
