import { expect, it } from 'vitest'
import { focusKeepsKey } from '../src/shortcutFocus'

const inside = (...selectors: string[]) => ({ closest: (selector: string) => selectors.includes(selector) || null })

it('leaves the key to text being written', () => {
  expect(focusKeepsKey(inside('[contenteditable="true"]'), true)).toBe(true)
})

it('leaves it to a terminal only where the key is Ctrl', () => {
  expect(focusKeepsKey(inside('.xterm'), false)).toBe(true)
  expect(focusKeepsKey(inside('.xterm'), true)).toBe(false)
})

it('keeps the app shortcut everywhere else', () => {
  expect(focusKeepsKey(inside(), true)).toBe(false)
  expect(focusKeepsKey(null, true)).toBe(false)
})
