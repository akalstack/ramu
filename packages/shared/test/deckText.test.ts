import { describe, expect, it } from 'vitest'
import { deckText, slideWords } from '../src/deckText'

describe('a deck’s words as one text', () => {
  const slides = [
    { title: 'Launch', body: 'Q3 plan' },
    { title: 'Compare', columns: ['Before', 'After'] as [string, string], notes: 'Pause here' },
  ]

  it('maps each slide’s fields there and back', () => {
    expect(slideWords(deckText(slides), 2)).toEqual([
      { title: 'Launch', body: 'Q3 plan', by: '', notes: '' },
      { title: 'Compare', body: '', by: '', notes: 'Pause here', columns: ['Before', 'After'] },
    ])
  })

  it('refuses a text that no longer has one entry per slide', () => {
    expect(slideWords(deckText(slides), 3)).toBeNull()
  })
})
