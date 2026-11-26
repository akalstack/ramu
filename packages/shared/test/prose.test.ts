import { describe, expect, it } from 'vitest'
import { PROSE, proseMetrics, proseVariables, type ProseDensity } from '../src/prose'

const densities = Object.keys(PROSE) as ProseDensity[]

describe('prose scale', () => {
  it('keeps every density readable: roomy lines, headings never smaller than body text, code a little smaller', () => {
    for (const density of densities) {
      const scale = PROSE[density]
      expect(scale.leading).toBeGreaterThanOrEqual(1.45)
      expect(scale.headings).toHaveLength(6)
      for (const [index, size] of scale.headings.entries()) {
        expect(size).toBeGreaterThanOrEqual(1)
        if (index) expect(size).toBeLessThanOrEqual(scale.headings[index - 1]!)
      }
      expect(scale.code).toBeLessThan(1)
      expect(scale.code).toBeGreaterThanOrEqual(0.84)
    }
  })

  it('gives a document the largest headings and a card the tightest spacing', () => {
    expect(PROSE.document.headings[0]).toBeGreaterThan(PROSE.reply.headings[0])
    expect(PROSE.compact.blockGap).toBeLessThan(PROSE.reply.blockGap)
    expect(PROSE.compact.size).toBe('control')
  })

  it('names one CSS variable per value for each density, in em where it is a length', () => {
    expect(proseVariables['--prose-reply-leading']).toBe('1.62')
    expect(proseVariables['--prose-document-h1']).toBe('1.6em')
    expect(proseVariables['--prose-compact-block-gap']).toBe('0.6em')
    expect(Object.keys(proseVariables)).toHaveLength(densities.length * 13)
  })

  it('turns the scale into whole points for the phone, following the body size', () => {
    const base = proseMetrics(15, 'reply')
    expect(base).toMatchObject({ size: 15, lineHeight: 24, blockGap: 11, code: 13 })
    expect(base.headings[0]).toEqual({ size: 21, lineHeight: 28 })
    expect(base.headings[5]).toEqual({ size: 15, lineHeight: 20 })

    // A larger text size grows every part of the block, not only the paragraphs.
    const larger = proseMetrics(15 * 1.25, 'reply')
    expect(larger.lineHeight).toBeGreaterThan(base.lineHeight)
    expect(larger.headings[0]!.size).toBeGreaterThan(base.headings[0]!.size)
    expect(larger.code).toBeGreaterThan(base.code)
  })
})
