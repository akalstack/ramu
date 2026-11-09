import { expect, it } from 'vitest'
import { parseArtifactSource } from '../src/artifactSource'
import { appliedDesignSystem, artifactKind } from '../src/artifacts'

it('reads a doc or diagram source and says what is wrong with one that does not fit', () => {
  expect(parseArtifactSource({ kind: 'doc', source: '# Plan', format: 'svg' })).toEqual({
    kind: 'doc',
    source: '# Plan',
  })
  expect(parseArtifactSource({ kind: 'diagram', format: 'mermaid', source: 'flowchart LR' })).toEqual({
    kind: 'diagram',
    format: 'mermaid',
    source: 'flowchart LR',
  })
  expect(() => parseArtifactSource({ kind: 'doc' })).toThrow('Write the doc as Markdown in source.')
  expect(() => parseArtifactSource({ kind: 'doc', source: 'x'.repeat(200_001) })).toThrow(
    'A doc is at most 200 KB of Markdown.',
  )
  expect(() => parseArtifactSource({ kind: 'diagram', source: 'flowchart LR' })).toThrow('format "mermaid" or "svg"')
  expect(() => parseArtifactSource({ kind: 'diagram', format: 'mermaid', source: 'x'.repeat(50_001) })).toThrow(
    'A Mermaid diagram is at most 50 KB.',
  )
  expect(() => parseArtifactSource({ kind: 'diagram', format: 'svg', source: '<p>hi</p>' })).toThrow(
    'An SVG diagram needs an <svg> element.',
  )
  expect(() => parseArtifactSource({ kind: 'app', source: '<p>hi</p>' })).toThrow()
})

it('opens a kind this build does not know as an app', () => {
  expect(artifactKind('doc')).toBe('doc')
  expect(artifactKind('diagram')).toBe('diagram')
  expect(artifactKind('slides')).toBe('slides')
  expect(artifactKind('podcast')).toBe('app')
  expect(artifactKind(undefined)).toBe('app')
})

it('reads a deck, filling in the theme, and names the slide and field of the first problem', () => {
  expect(parseArtifactSource({ kind: 'slides', slides: [{ layout: 'title', title: 'Hi' }] })).toEqual({
    kind: 'slides',
    slides: [{ layout: 'title', title: 'Hi' }],
    theme: { appearance: 'auto' },
  })
  const deck = (slides: unknown[], theme?: unknown) => () => parseArtifactSource({ kind: 'slides', slides, theme })
  expect(deck([{ layout: 'content', title: 'A' }])).toThrow('Slide 1: a content slide needs body.')
  expect(
    deck([
      { layout: 'title', title: 'A' },
      { layout: 'quote', body: ' ' },
    ]),
  ).toThrow('Slide 2: a quote slide needs body.')
  expect(deck([{ layout: 'image', image: { path: 'a.png', alt: 'A' }, columns: ['a', 'b'] }])).toThrow(
    'Slide 1: an image slide does not show columns.',
  )
  expect(deck([{ layout: 'title', title: 'x'.repeat(201) }])).toThrow(
    'Slide 1 title: Slide text is at most 200 characters. Split the slide.',
  )
  expect(
    deck([{ layout: 'chart', chart: { type: 'pie', labels: ['a', 'b'], series: [{ name: 'n', values: [0, 0] }] } }]),
  ).toThrow('Slide 1: a pie chart needs values of zero or more, and at least one above zero.')
  expect(deck([{ layout: 'title', title: 'A' }], { accent: 'violet' })).toThrow(
    'Give the accent as a hex color such as #7652d4.',
  )
  expect(deck([])).toThrow('Write the deck as a list of slides in slides.')
})

it('applies a project’s own design system before the host’s', () => {
  const state: Record<string, string | null> = { 'design-system': 'host-brand' }
  const read = (key: string) => state[key] ?? null
  expect(appliedDesignSystem(read, null)).toBe('host-brand')
  expect(appliedDesignSystem(read, 'p1')).toBe('host-brand')
  state['design-system:p1'] = 'client-brand'
  expect(appliedDesignSystem(read, 'p1')).toBe('client-brand')
  expect(appliedDesignSystem(read, 'p2')).toBe('host-brand')
})

it('takes a dashboard table from any plugin data source, with its own query fields', () => {
  const board = (service: unknown) =>
    parseArtifactSource({
      kind: 'dashboard',
      datasets: [{ id: 'up', columns: ['Time', 'Value'], service }],
      figures: [{ label: 'Up', dataset: 'up', column: 'Value' }],
    })
  const parsed = board({ id: 'grafana', datasource: 'prom', query: { expr: 'sum(up)' }, from: 'now-7d' })
  expect(parsed.kind === 'dashboard' && parsed.datasets[0]?.service).toEqual({
    id: 'grafana',
    datasource: 'prom',
    query: { expr: 'sum(up)' },
    from: 'now-7d',
  })
  expect(() => board({ id: 'Grafana!' })).toThrow('Name a data source such as grafana.')
  expect(() => board({ id: 'grafana', query: ['a'] })).toThrow()
  expect(() =>
    board({ id: 'grafana', ...Object.fromEntries(Array.from({ length: 22 }, (_, n) => [`f${n}`, n])) }),
  ).toThrow('at most 20 fields')
})
