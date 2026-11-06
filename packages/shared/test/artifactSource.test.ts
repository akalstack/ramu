import { expect, it } from 'vitest'
import { parseArtifactSource } from '../src/artifactSource'
import { artifactKind } from '../src/artifacts'

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
  expect(artifactKind('slides')).toBe('app')
  expect(artifactKind(undefined)).toBe('app')
})
