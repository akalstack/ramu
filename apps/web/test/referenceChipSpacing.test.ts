import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { InlineChip } from '../src/composer/ComposerInput'
import { ReferenceChipView } from '../src/chat/ReferenceChipView'

it('keeps the icon apart from the text, at full size, in the composer and the transcript alike', () => {
  const chip = { kind: 'quote', label: 'x'.repeat(600) } as never
  for (const markup of [
    renderToStaticMarkup(createElement(InlineChip, { chip })),
    renderToStaticMarkup(createElement(ReferenceChipView, { chip })),
  ]) {
    expect(markup).toContain('--reference-chip-gap:4px')
    expect(markup).toContain('--reference-chip-width:360px')
    expect(markup).toContain('[&amp;&gt;:first-child]:flex-none')
  }
})
