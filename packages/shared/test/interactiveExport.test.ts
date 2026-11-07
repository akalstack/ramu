import { expect, it } from 'vitest'
import { hostExportFormats, interactiveExport, kindExports, slideCount } from '../src/interactiveExport'
import type { InteractiveDocument } from '../src/interactive'
const document: InteractiveDocument = {
  reference: {
    id: '../content',
    version: 2,
    sessionId: 's',
    network: { resources: [], connect: [] },
    title: 'Title',
    summary: '',
    digest: 'hash',
    createdAt: 1,
    checked: true,
  },
  html: '<p>Exact source</p>\n',
  preview: null,
}
it("exports styled source and a runnable snapshot in the reader's theme, with a safe filename", () => {
  const theme = { '--scheme': 'light', '--background': '#ffffff', '--primary': '#5b36b8', 'bad;': 'x' }
  const source = interactiveExport(document, { controls: [], custom: { step: 3 } }, true, theme)
  expect(source.name).toBe('interactive-content-v2-source.html')
  // The saved source is unchanged inside it; only tokens and base styles are added, never a script or scenario.
  expect(source.html).toContain(`<body>${document.html}</body>`)
  expect(source.html).toContain(':root{--scheme:light;--background:#ffffff;--primary:#5b36b8;}')
  expect(source.html).toContain('html{font:14px/1.5 var(--font-sans)')
  expect(source.html).not.toMatch(/<script|"step"|bad;/)
  const runnable = interactiveExport(document, { controls: [], custom: { step: 3 } }, false, theme)
  expect(runnable.html).toContain(document.html)
  expect(runnable.html).toContain('"step":3')
  expect(runnable.html).toContain('--background:#ffffff;')
  expect(runnable.html).toContain('Content-Security-Policy')
  expect(interactiveExport(document, { custom: 'invalid' }).html).toContain('initial=null')
})

it('exports a doc as Markdown and HTML and a diagram as SVG and Mermaid, from the sources its version keeps', () => {
  const doc: InteractiveDocument = {
    ...document,
    reference: { ...document.reference, kind: 'doc', title: 'Plan: Q3/Q4' },
    html: '<article class="ramu-doc"><h1 id="plan">Plan</h1></article>',
    files: [{ path: 'document.md', content: '# Plan' }],
  }
  expect(kindExports(doc).map(({ format, file }) => [format, file.name, file.mimeType])).toEqual([
    ['markdown', 'Plan Q3Q4.md', 'text/markdown'],
    ['html', 'Plan Q3Q4.html', 'text/html'],
  ])
  expect(kindExports(doc)[0]!.file.content).toBe('# Plan')
  expect(kindExports(doc)[1]!.file.content).toContain(`<body>${doc.html}</body>`)
  const diagram = (files: InteractiveDocument['files']): InteractiveDocument => ({
    ...document,
    reference: { ...document.reference, kind: 'diagram', title: 'Sync' },
    files,
  })
  expect(
    kindExports(
      diagram([
        { path: 'diagram.mmd', content: 'flowchart LR' },
        { path: 'diagram.svg', content: '<svg/>' },
      ]),
    ).map(({ format, file }) => [format, file.name, file.content]),
  ).toEqual([
    ['svg', 'Sync.svg', '<svg/>'],
    ['mermaid', 'Sync.mmd', 'flowchart LR'],
  ])
  expect(kindExports(diagram([{ path: 'diagram.svg', content: '<svg/>' }])).map(({ format }) => format)).toEqual([
    'svg',
  ])
  expect(kindExports(document)).toEqual([])
})

it('exports a deck as HTML on the device and asks the host for PowerPoint, PDF and slide images', () => {
  const deck: InteractiveDocument = {
    ...document,
    reference: { ...document.reference, kind: 'slides', title: 'Review' },
    html: '<div class="ramu-deck"></div>',
    files: [{ path: 'slides.json', content: JSON.stringify({ slides: [{}, {}, {}], theme: { appearance: 'auto' } }) }],
  }
  expect(kindExports(deck).map(({ format, file }) => [format, file.name])).toEqual([['html', 'Review.html']])
  expect(slideCount(deck)).toBe(3)
  expect(slideCount({ ...deck, files: [{ path: 'slides.json', content: '{' }] })).toBe(0)
  expect(slideCount(document)).toBe(0)
  expect(hostExportFormats('slides')).toEqual(['pptx', 'pdf', 'png'])
  expect(hostExportFormats('app')).toEqual(['pdf'])
  expect(hostExportFormats('doc')).toEqual(['docx', 'pdf'])
})
