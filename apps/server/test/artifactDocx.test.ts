import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { writeDocx } from '../src/interactive/docx'

const documentXml = async (markdown: string) => {
  const zip = await JSZip.loadAsync(await writeDocx(markdown, 'Launch plan'))
  return zip.file('word/document.xml')!.async('string')
}

it('writes a doc’s headings, lists, tables, code and links into a Word file', async () => {
  const xml = await documentXml(
    [
      '# Launch plan',
      '',
      'Ship **sync** on *Friday*, see [the board](https://example.com/board).',
      '',
      '- [x] Write the notes',
      '- [ ] Record the demo',
      '  1. Script',
      '',
      '| Risk | Owner |',
      '| --- | --- |',
      '| Data loss | Ana |',
      '',
      '```ts',
      'const ready = true',
      '```',
      '',
      '> Keep it small.',
    ].join('\n'),
  )
  expect(xml).toContain('Heading1')
  expect(xml).toContain('Launch plan')
  expect(xml).toMatch(/<w:b\/>[\s\S]*?sync/)
  expect(xml).toContain('☑ ')
  expect(xml).toContain('☐ ')
  expect(xml).toContain('<w:numPr>')
  expect(xml).toContain('<w:tbl>')
  expect(xml).toContain('Data loss')
  expect(xml).toContain('const ready = true')
  expect(xml).toContain('Keep it small.')
  expect(xml).toContain('<w:hyperlink')
})

it('keeps only web and mail links as links and never fetches an image', async () => {
  const xml = await documentXml('[local](file:///etc/passwd) and ![a chart of signups](https://example.com/x.png)')
  expect(xml).not.toContain('<w:hyperlink')
  expect(xml).toContain('local')
  expect(xml).toContain('[a chart of signups]')
})

it('embeds the doc’s own images and describes others', async () => {
  // A 1 × 1 PNG.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const zip = await JSZip.loadAsync(
    await writeDocx('![Chart](chart.png)\n\n![Logo](https://example.com/logo.png)\n', 'Launch plan', [
      { path: 'chart.png', content: png, encoding: 'base64' },
    ]),
  )
  const xml = await zip.file('word/document.xml')!.async('string')
  expect(xml).toContain('descr="Chart"')
  expect(xml).toContain('[Logo]')
  expect(Object.keys(zip.files).some((name) => name.startsWith('word/media/'))).toBe(true)
})
