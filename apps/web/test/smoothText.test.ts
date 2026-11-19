import { expect, it } from 'vitest'
import { nextReveal } from '../src/views/agent/lib/smoothText'

it('writes a burst out over a short while instead of all at once', () => {
  const text = 'word '.repeat(80)
  const first = nextReveal(text, 0, 16)
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThan(text.length / 4)
  let shown = 0
  for (let frame = 0; frame < 90; frame++) shown = nextReveal(text, shown, 16)
  expect(shown).toBe(text.length)
})

it('never stops inside a word', () => {
  const text = 'extraordinarily long words keep together'
  for (let shown = 0; shown < text.length;) {
    shown = nextReveal(text, shown, 4)
    expect(shown === text.length || !/\S/.test(text[shown]!) || !/\S/.test(text[shown - 1]!)).toBe(true)
  }
})

it('shows everything once caught up, and keeps a surrogate pair whole', () => {
  expect(nextReveal('done', 4, 16)).toBe(4)
  const emoji = '😀😀😀😀😀😀😀😀'
  for (let shown = 0; shown < emoji.length;) {
    shown = nextReveal(emoji, shown, 1)
    expect(shown % 2).toBe(0)
  }
})
