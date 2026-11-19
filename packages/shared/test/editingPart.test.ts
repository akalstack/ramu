import { describe, expect, it } from 'vitest'
import { caretAfter, changedAt, headingAt } from '../src/editingPart'

describe('the part a person is editing', () => {
  it('names the heading above where they last typed', () => {
    const before = '# Plan\n\n## Goals\n\nShip sync.\n\n## Owner\n\nAyu\n'
    const after = before.replace('Ayu', 'Ayu and Bo')
    expect(headingAt(after, changedAt(before, after)!)).toBe('Owner')
    expect(headingAt('Intro\n\n## Goals\n', 2)).toBeNull()
    expect(changedAt(before, before)).toBeNull()
  })
})

describe('the caret when others type in the same text', () => {
  it('stays put for typing after it and moves with typing before it', () => {
    // The caret sits after "Ship" (4).
    expect(caretAfter('Ship it today', 'Ship it today, Bo says', 4)).toBe(4)
    expect(caretAfter('Ship it today', 'Please ship it today', 4)).toBe(11)
    expect(caretAfter('Ship it today', 'it today', 7)).toBe(2)
    // Inside a span someone replaced, it goes to the end of their words.
    expect(caretAfter('Ship it today', 'Ship them all today', 6)).toBe(13)
    expect(caretAfter('Same', 'Same', 2)).toBe(2)
  })
})
