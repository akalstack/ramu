import { describe, expect, it } from 'vitest'
import { composerDraft, deleteDraftAtom } from '../src/chat/composerDraft'

describe('inline composer atoms', () => {
  it('keeps skills, files and ordinary text in their original order', () => {
    const value = 'Use $imagegen with @"ramu/logo.svg" please'
    const draft = composerDraft(value)
    expect(draft.segments.map((segment) => segment.source).join('')).toBe(value)
    expect(draft.chips.map((chip) => chip.label)).toEqual(['imagegen', 'logo.svg'])
  })
  it('leaves incomplete tokens editable until completed', () => {
    expect(composerDraft('$imag').chips).toHaveLength(0)
    expect(composerDraft('/go').chips).toHaveLength(0)
    expect(composerDraft('$imagegen ').chips).toHaveLength(1)
  })
  it('removes a skill as one unit with Backspace', () => {
    expect(deleteDraftAtom('Use $imagegen please', 13, 'Backspace')).toEqual({ value: 'Use  please', caret: 4 })
  })
  it('removes file context as one unit with Delete', () => {
    const value = '@"ramu/logo.svg" Update this'
    expect(deleteDraftAtom(value, 0, 'Delete')).toEqual({ value: ' Update this', caret: 0 })
  })
  it('does not delete a reference when the caret is inside ordinary text', () => {
    expect(deleteDraftAtom('$shadcn check this', 12, 'Backspace')).toBeNull()
  })
  it('shows commands without the slash while retaining their submitted syntax', () => {
    const draft = composerDraft('/goal Fix tests')
    expect(draft.chips[0]?.label).toBe('goal')
    expect(draft.segments.map((segment) => segment.source).join('')).toBe('/goal Fix tests')
  })
  it('preserves quote text and whitespace, without parsing references inside the quote', () => {
    const value = '> First line\n> Use $imagegen here\n\nExplain this'
    const draft = composerDraft(value)
    expect(draft.chips).toHaveLength(1)
    expect(draft.chips[0]?.label).toBe('First line\nUse $imagegen here')
    expect(draft.segments.map((segment) => segment.source).join('')).toBe(value)
  })

  it('keeps the blank line after a quote in its chip, so typing continues beside it', () => {
    const value = '> Quoted\n\nReply'
    const [quote] = composerDraft(value).chips
    expect(quote).toMatchObject({ kind: 'quote', start: 0, end: 10, label: 'Quoted' })
    expect(value.slice(quote!.end)).toBe('Reply')
  })
  it('leaves code examples and prices as text', () => {
    const value = '`$imagegen` and $100\n```sh\n$HOME\n```'
    expect(composerDraft(value).chips).toHaveLength(0)
    expect(composerDraft(value).segments).toEqual([{ kind: 'text', source: value }])
  })
})
