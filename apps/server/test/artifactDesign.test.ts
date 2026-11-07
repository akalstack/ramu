import { expect, it } from 'vitest'
import { parseArtifactSource } from '@ramu/shared/artifactSource'
import { renderDesign } from '../src/interactive/design'

const design = (frames: unknown) => parseArtifactSource({ kind: 'design', frames })

it('checks a design’s frames', () => {
  expect(() => design([])).toThrow('A design needs at least one frame')
  expect(() => design([{ name: 'Tiny', width: 100, height: 300, html: '<p>Hi</p>' }])).toThrow()
})

it('draws each frame at its size with styles that reach only that frame', () => {
  const source = design([
    {
      name: 'Pricing (desktop)',
      width: 1440,
      height: 900,
      html: '<h1>Plans</h1>',
      css: 'h1{color:red}</style><script>',
    },
    { name: 'Pricing (phone)', width: 390, height: 844, html: '<h1>Plans</h1>' },
  ])
  if (source.kind !== 'design') throw new Error('not a design')
  const drawn = renderDesign(source, 'Pricing')
  expect(drawn.html).toContain('style="width:1440px;height:900px"')
  expect(drawn.html).toContain('@scope ([data-ramu-frame="0"]) {h1{color:red}<\\/style><script>}')
  expect(drawn.html).not.toContain('</style><script>')
  expect(drawn.html).toContain('data-ramu-fit="Frame Pricing (phone)"')
  expect(JSON.parse(drawn.files[0]!.content).frames).toHaveLength(2)
})
