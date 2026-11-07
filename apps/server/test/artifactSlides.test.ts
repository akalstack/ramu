import JSZip from 'jszip'
import { afterEach, expect, it, vi } from 'vitest'
import { parseArtifactSource, type Slide } from '@ramu/shared/artifactSource'
import { openDb, type Db } from '../src/db'
import { ArtifactExports } from '../src/interactive/exports'
import { PageStore } from '../src/interactive/pages'
import { interactiveBrowserPath, previewInteractive } from '../src/interactive/preview'
import { writePptx } from '../src/interactive/pptx'
import { imageSize, slideText } from '../src/interactive/slides'
import { InteractiveStore, type InteractiveInput } from '../src/interactive/store'

// A 1 × 1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const databases: Db[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const previewer = vi.fn(async (_html: string) => ({
  screenshot: 'data:image/png;base64,AA==',
  height: 400,
  checks: [],
  errors: [] as string[],
}))

function setup(preview: ConstructorParameters<typeof InteractiveStore>[2] = previewer) {
  const db = openDb(':memory:')
  databases.push(db)
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','P',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','T','current','idle',0); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES('s','t','codex','/tmp','idle',0)",
  )
  const interactive = new InteractiveStore(db, vi.fn(), preview)
  return { db, interactive, pages: new PageStore(db, interactive) }
}

const SLIDES: Slide[] = [
  { layout: 'title', title: 'Sync, explained', body: 'Q3 review', notes: 'Welcome everyone.' },
  {
    layout: 'content',
    title: 'What changed',
    body: '- **Faster** sync\n- Fewer `conflicts`',
    image: { path: 'shot.png', alt: 'The sync screen' },
  },
  { layout: 'two-columns', title: 'Before and after', columns: ['1. Slow\n2. Manual', 'Fast and *automatic*'] },
  {
    layout: 'chart',
    title: 'Sync time',
    chart: { type: 'bar', labels: ['May', 'June'], series: [{ name: 'Seconds', values: [9, 3] }], unit: ' s' },
    body: 'Median per device',
  },
  {
    layout: 'chart',
    chart: { type: 'pie', labels: ['Phone', 'Laptop'], series: [{ name: 'Share', values: [40, 60] }] },
  },
  { layout: 'quote', body: 'It just works now.', by: 'Ana' },
]
const deck = (slides: Slide[] = SLIDES, files?: InteractiveInput['files']): InteractiveInput => ({
  kind: 'slides',
  slides,
  theme: { appearance: 'dark', accent: '#2563eb' },
  ...(files ? { files } : {}),
  title: 'Sync review',
  summary: 'A short deck',
  checks: [],
})
const image = [{ path: 'shot.png', content: PNG, encoding: 'base64' as const }]

it('publishes a deck drawn as 16:9 slides, and keeps its slide list and images', async () => {
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', deck(SLIDES, image))
  expect(preview.errors).toEqual([])
  const html = previewer.mock.calls.at(-1)![0]
  expect(html.match(/<section class="ramu-slide" data-ramu-slide/g)).toHaveLength(6)
  expect(html).toContain('aria-label="Slide 2 of 6"')
  expect(html).toContain('data-ramu-fit="Slide 2 body"')
  expect(html).toContain('<li><strong>Faster</strong> sync</li>')
  expect(html).toContain('<ol><li>Slow</li><li>Manual</li></ol>')
  expect(html).toContain(`src="data:image/png;base64,${PNG}"`)
  expect(html).toContain('aria-label="Bar chart. May: 9 s; June: 3 s"')
  expect(html).toContain('--primary:#2563eb')
  expect(html).not.toContain('<script')
  // Speaker notes are for the presenter, not the slide.
  expect(html).not.toContain('Welcome everyone.')
  const reference = interactive.publish('s', preview.id, 'r1')
  expect(reference).toMatchObject({ kind: 'slides', files: ['slides.json', 'shot.png'] })
  expect(reference.libraries).toBeUndefined()
  const kept = pages.keep('s', reference.id, { title: 'Sync review' })
  expect(kept.kind).toBe('slides')
  const files = pages.document(kept.id).files!
  expect(JSON.parse(files[0]!.content).slides).toHaveLength(6)
  expect(files[1]).toEqual({ path: 'shot.png', content: PNG, encoding: 'base64' })
})

it('checks a deck before drawing it, slide by slide', async () => {
  const { interactive } = setup()
  const base = { title: 'X', summary: 'Y', checks: [] }
  await expect(interactive.preview('s', { ...base, kind: 'slides', slides: [] })).rejects.toThrow(
    'Write the deck as a list of slides in slides.',
  )
  await expect(interactive.preview('s', deck([{ layout: 'chart', title: 'Empty' }]))).rejects.toThrow(
    'Slide 1: a chart slide needs chart.',
  )
  await expect(interactive.preview('s', deck([{ layout: 'title', title: 'Hi', by: 'Ana' }]))).rejects.toThrow(
    'Slide 1: a title slide does not show by. Remove it or change the layout.',
  )
  await expect(
    interactive.preview(
      's',
      deck([{ layout: 'chart', chart: { type: 'line', labels: ['a', 'b'], series: [{ name: 'n', values: [1] }] } }]),
    ),
  ).rejects.toThrow('Slide 1: every chart series needs one value per label.')
  await expect(interactive.preview('s', { ...base, slides: SLIDES })).rejects.toThrow(
    'Set kind to doc, diagram, slides or dashboard',
  )
  await expect(interactive.preview('s', { ...deck(), html: '<p>x</p>' })).rejects.toThrow('html is for apps')
  expect(() => parseArtifactSource({ kind: 'slides', slides: Array.from({ length: 61 }, () => SLIDES[0]) })).toThrow(
    'A deck has at most 60 slides. Split it into two decks.',
  )
})

it('fails a deck whose image is missing or is not a PNG or JPEG', async () => {
  const { interactive } = setup()
  const preview = await interactive.preview(
    's',
    deck([SLIDES[1]!], [{ path: 'notes.txt', content: Buffer.from('hello').toString('base64'), encoding: 'base64' }]),
  )
  expect(preview.errors).toEqual([
    'Slide 1 shows shot.png, which is not among the images in files. Send it as a PNG or JPEG with encoding base64.',
    "notes.txt is not a PNG or JPEG sent with encoding base64. A deck's files are its images.",
  ])
})

it('reads slide text and image sizes', () => {
  expect(slideText('Intro line\ncontinues\n\n- **a** [link](https://x.test)\n2) two')).toEqual([
    { list: 'none', runs: [{ text: 'Intro line continues' }] },
    { list: 'bullet', runs: [{ text: 'a', bold: true }, { text: ' ' }, { text: 'link' }] },
    { list: 'number', runs: [{ text: 'two' }] },
  ])
  expect(imageSize(Buffer.from(PNG, 'base64'))).toEqual({ width: 1, height: 1, mime: 'image/png' })
  expect(imageSize(Buffer.from('GIF89a'))).toBeNull()
})

it('writes a deck as PowerPoint with one slide per slide, native charts and speaker notes', async () => {
  const source = parseArtifactSource({ kind: 'slides', slides: SLIDES })
  if (source.kind !== 'slides') throw new Error('not a deck')
  const zip = await JSZip.loadAsync(await writePptx(source, 'Sync review', image))
  const names = Object.keys(zip.files)
  expect(names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(6)
  expect(names.filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))).toHaveLength(2)
  expect(names.some((name) => name.startsWith('ppt/media/'))).toBe(true)
  expect(await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string')).toContain('Welcome everyone.')
  expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain('Faster')
})

it('keeps each export with its version, so the second one is instant, and offers only the kind’s formats', async () => {
  const { db, interactive } = setup()
  const pdf = vi.fn(async () => Buffer.from('%PDF-1.7 made'))
  const exports = new ArtifactExports(db, { pdf, png: vi.fn() })
  const preview = await interactive.preview('s', deck(SLIDES, image))
  const reference = interactive.publish('s', preview.id, 'r1')
  const document = interactive.get('s', reference.id, 1)
  const first = await exports.make(document, 'pdf')
  expect(first).toMatchObject({ name: 'Sync review.pdf', mimeType: 'application/pdf', encoding: 'base64' })
  expect(Buffer.from(first.content, 'base64').toString()).toBe('%PDF-1.7 made')
  expect(await exports.make(document, 'pdf')).toEqual(first)
  expect(pdf).toHaveBeenCalledTimes(1)
  const pptx = await exports.make(document, 'pptx')
  expect(pptx.name).toBe('Sync review.pptx')
  expect(Object.keys((await JSZip.loadAsync(Buffer.from(pptx.content, 'base64'))).files)).toContain(
    'ppt/slides/slide6.xml',
  )
  const doc = await interactive.preview('s', { kind: 'doc', source: '# Hi', title: 'Doc', summary: 'D', checks: [] })
  const docReference = interactive.publish('s', doc.id, 'r2')
  await expect(exports.make(interactive.get('s', docReference.id, 1), 'pptx')).rejects.toThrow(
    'This doc does not export as pptx.',
  )
})

it.skipIf(!interactiveBrowserPath())(
  'fails a slide whose text does not fit, and prints a deck one slide per page',
  async () => {
    const { db, interactive } = setup(previewInteractive)
    const long = Array.from({ length: 30 }, (_, i) => `- Point ${i + 1} that goes on for a while`).join('\n')
    const bad = await interactive.preview('s', deck([SLIDES[0]!, { layout: 'content', title: 'Too much', body: long }]))
    expect(bad.errors).toEqual(['Slide 2 body does not fit on the slide. Shorten it or split the slide.'])
    const good = await interactive.preview('s', deck(SLIDES, image))
    expect(good.errors).toEqual([])
    const reference = interactive.publish('s', good.id, 'r1')
    const exports = new ArtifactExports(db)
    const document = interactive.get('s', reference.id, 1)
    const pdf = Buffer.from((await exports.make(document, 'pdf')).content, 'base64')
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(6)
    const png = await JSZip.loadAsync(Buffer.from((await exports.make(document, 'png')).content, 'base64'))
    expect(Object.keys(png.files)).toEqual([
      'slide-1.png',
      'slide-2.png',
      'slide-3.png',
      'slide-4.png',
      'slide-5.png',
      'slide-6.png',
    ])
    const first = await png.file('slide-1.png')!.async('nodebuffer')
    expect(imageSize(first)).toMatchObject({ width: 1920, height: 1080 })
  },
  60_000,
)

it('exports a doc as Word and a diagram as one PNG image', async () => {
  const { db, interactive } = setup()
  const png = vi.fn(async () => Buffer.from('\x89PNG made'))
  const exports = new ArtifactExports(db, { pdf: vi.fn(), png })
  const doc = await interactive.preview('s', {
    kind: 'doc',
    source: '# Plan\n\n- one',
    title: 'Plan',
    summary: 'P',
    checks: [],
  })
  const docx = await exports.make(interactive.get('s', interactive.publish('s', doc.id, 'r1').id, 1), 'docx')
  expect(docx).toMatchObject({
    name: 'Plan.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  expect(Object.keys((await JSZip.loadAsync(Buffer.from(docx.content, 'base64'))).files)).toContain('word/document.xml')
  const diagram = await interactive.preview('s', {
    kind: 'diagram',
    format: 'mermaid',
    source: 'flowchart LR\n  A --> B',
    title: 'Flow',
    summary: 'F',
    checks: [],
  })
  const image = await exports.make(interactive.get('s', interactive.publish('s', diagram.id, 'r2').id, 1), 'png')
  expect(image).toMatchObject({ name: 'Flow.png', mimeType: 'image/png' })
  expect(png).toHaveBeenCalledTimes(1)
})

it.skipIf(!interactiveBrowserPath())(
  'draws a diagram’s PNG in the host’s browser',
  async () => {
    const { db, interactive } = setup(previewInteractive)
    const diagram = await interactive.preview('s', {
      kind: 'diagram',
      format: 'mermaid',
      source: 'flowchart LR\n  A --> B',
      title: 'Flow',
      summary: 'F',
      checks: [],
    })
    const document = interactive.get('s', interactive.publish('s', diagram.id, 'r1').id, 1)
    const png = Buffer.from((await new ArtifactExports(db).make(document, 'png')).content, 'base64')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  },
  60_000,
)

it.skipIf(!interactiveBrowserPath())(
  'previews a dashboard and draws its PNG in the host’s browser',
  async () => {
    const { db, interactive } = setup(previewInteractive)
    const board = await interactive.preview('s', {
      kind: 'dashboard',
      datasets: [
        {
          id: 'costs',
          columns: ['service', 'usd'],
          rows: [
            ['Vercel', 20],
            ['Neon', 19],
          ],
        },
      ],
      figures: [{ label: 'Total', dataset: 'costs', column: 'usd', unit: ' USD' }],
      charts: [{ title: 'By service', type: 'pie', dataset: 'costs', x: 'service', y: ['usd'] }],
      title: 'Costs',
      summary: 'C',
      checks: [],
    })
    expect(board.errors).toEqual([])
    const document = interactive.get('s', interactive.publish('s', board.id, 'r1').id, 1)
    expect(document.reference.kind).toBe('dashboard')
    const png = Buffer.from((await new ArtifactExports(db).make(document, 'png')).content, 'base64')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  },
  60_000,
)
