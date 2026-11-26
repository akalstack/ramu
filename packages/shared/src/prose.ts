/**
 * One reading scale for rendered Markdown and other long-form text, on the desktop and the phone. Every length is a
 * multiple of the surface's body size, so text-size settings on either device scale the whole block, not only its
 * paragraphs.
 *
 * - `reply`: an agent's answer and anything read the same way (reports, summaries, checkpoints, review diffs).
 * - `compact`: text inside a card or a row (thinking, comments, task results, learned notes).
 * - `document`: a whole Markdown file, with a larger heading scale as a document on a forge shows one.
 */
export type ProseDensity = 'reply' | 'compact' | 'document'

interface ProseScale {
  /** Which of the app's text sizes the body uses: the chat size, or the smaller control size. */
  size: 'body' | 'control'
  /** Body line height. */
  leading: number
  /** Space after a paragraph, list, quote, table or code block. */
  blockGap: number
  /** Space between list items. */
  itemGap: number
  /** Space above a heading that follows other content. The space below it is half a block gap. */
  headingGap: number
  /** h1 to h6. */
  headings: readonly [number, number, number, number, number, number]
  headingLeading: number
  /** Inline code and code blocks, which read larger than body text at the same size. */
  code: number
  codeLeading: number
}

export const PROSE: Readonly<Record<ProseDensity, ProseScale>> = {
  reply: {
    size: 'body',
    leading: 1.62,
    blockGap: 0.75,
    itemGap: 0.3,
    headingGap: 1.45,
    headings: [1.4, 1.28, 1.14, 1, 1, 1],
    headingLeading: 1.35,
    code: 0.86,
    codeLeading: 1.5,
  },
  compact: {
    size: 'control',
    leading: 1.5,
    blockGap: 0.6,
    itemGap: 0.2,
    headingGap: 1,
    headings: [1.15, 1.08, 1, 1, 1, 1],
    headingLeading: 1.35,
    code: 0.9,
    codeLeading: 1.45,
  },
  document: {
    size: 'body',
    leading: 1.65,
    blockGap: 0.86,
    itemGap: 0.25,
    headingGap: 1.45,
    headings: [1.6, 1.3, 1.1, 1, 1, 1],
    headingLeading: 1.3,
    code: 0.88,
    codeLeading: 1.55,
  },
}

const PROSE_DENSITIES = Object.keys(PROSE) as ProseDensity[]

/**
 * The scale as CSS custom properties (`--prose-reply-leading`, `--prose-document-h1`, …), set once on the desktop's root
 * so its stylesheet reads the same numbers the phone does.
 */
export const proseVariables: Readonly<Record<string, string>> = Object.fromEntries(
  PROSE_DENSITIES.flatMap((density) => {
    const scale = PROSE[density]
    const name = (part: string) => `--prose-${density}-${part}`
    return [
      [name('leading'), String(scale.leading)],
      [name('block-gap'), `${scale.blockGap}em`],
      [name('item-gap'), `${scale.itemGap}em`],
      [name('heading-gap'), `${scale.headingGap}em`],
      [name('heading-leading'), String(scale.headingLeading)],
      [name('code'), `${scale.code}em`],
      [name('code-leading'), String(scale.codeLeading)],
      ...scale.headings.map((size, index) => [name(`h${index + 1}`), `${size}em`]),
    ]
  }),
)

export interface ProseMetrics {
  size: number
  lineHeight: number
  blockGap: number
  itemGap: number
  headingGap: number
  /** h1 to h6, each with its own line height. */
  headings: readonly { size: number; lineHeight: number }[]
  code: number
  codeLineHeight: number
}

/** The scale in whole points for a native renderer, given the body size the density's `size` names. */
export function proseMetrics(size: number, density: ProseDensity): ProseMetrics {
  const scale = PROSE[density]
  const round = (value: number) => Math.round(value)
  const code = round(size * scale.code)
  return {
    size,
    lineHeight: round(size * scale.leading),
    blockGap: round(size * scale.blockGap),
    itemGap: round(size * scale.itemGap),
    headingGap: round(size * scale.headingGap),
    headings: scale.headings.map((step) => {
      const heading = round(size * step)
      return { size: heading, lineHeight: round(heading * scale.headingLeading) }
    }),
    code,
    codeLineHeight: round(code * scale.codeLeading),
  }
}
