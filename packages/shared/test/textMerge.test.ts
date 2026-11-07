import { describe, expect, it } from 'vitest'
import { mergeText } from '../src/textMerge'

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
