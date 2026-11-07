import { describe, expect, it } from 'vitest'
import type { Slide } from '../src/artifactSource'
import { mergeSlideText, mergeText } from '../src/textMerge'

const base = ['# Menu', '', 'Coffee 3', 'Tea 2', '', 'Open daily'].join('\n')

describe('three-way text merge', () => {
  it('keeps both edits when they change different lines', () => {
    const phone = base.replace('Coffee 3', 'Coffee 4')
    const desktop = base.replace('Open daily', 'Open daily, 7 to 5')
    expect(mergeText(base, desktop, phone)).toBe(
      ['# Menu', '', 'Coffee 4', 'Tea 2', '', 'Open daily, 7 to 5'].join('\n'),
    )
  })

  it('keeps insertions at different places and a deletion elsewhere', () => {
    const phone = base.replace('Tea 2', 'Tea 2\nCocoa 3')
    const desktop = base.replace('# Menu\n', '')
    expect(mergeText(base, desktop, phone)).toBe(['', 'Coffee 3', 'Tea 2', 'Cocoa 3', '', 'Open daily'].join('\n'))
  })

  it('takes a change made the same way on both sides once', () => {
    const both = base.replace('Tea 2', 'Tea 2.5')
    expect(mergeText(base, both, both)).toBe(both)
    expect(mergeText(base, both, base)).toBe(both)
  })

  it('is a conflict when both change the same line differently, or insert at one place', () => {
    expect(mergeText(base, base.replace('Tea 2', 'Tea 3'), base.replace('Tea 2', 'Green tea 2'))).toBeNull()
    expect(mergeText(base, base.replace('Tea 2', 'Tea 2\nA'), base.replace('Tea 2', 'Tea 2\nB'))).toBeNull()
  })
})

describe('merging a deck’s slide text', () => {
  const deck: Slide[] = [
    { layout: 'title' as const, title: 'Launch', body: 'Q3 plan' },
    { layout: 'content' as const, title: 'Goals', body: '- Ship sync\n- Fix login' },
  ]

  it('keeps both edits to different slides or lines, with the current deck’s other fields', () => {
    const mine = [deck[0]!, { ...deck[1]!, body: '- Ship sync on Friday\n- Fix login' }]
    const current = [
      { ...deck[0]!, title: 'Launch day' },
      { ...deck[1]!, notes: 'Say the date' },
    ]
    expect(mergeSlideText(deck, mine, current)).toEqual([
      { layout: 'title', title: 'Launch day', body: 'Q3 plan' },
      { layout: 'content', title: 'Goals', body: '- Ship sync on Friday\n- Fix login', notes: 'Say the date' },
    ])
  })

  it('refuses when the same text changed both ways, or slides were added or relaid out', () => {
    const mine = [{ ...deck[0]!, title: 'Kickoff' }, deck[1]!]
    expect(mergeSlideText(deck, mine, [{ ...deck[0]!, title: 'Launch day' }, deck[1]!])).toBeNull()
    expect(mergeSlideText(deck, mine, [...deck, deck[1]!])).toBeNull()
    expect(mergeSlideText(deck, mine, [{ ...deck[0]!, layout: 'content' as const }, deck[1]!])).toBeNull()
  })
})
