import { expect, it, vi } from 'vitest'
import { designTokenCss, parseArtifactSource } from '@ramu/shared/artifactSource'
import { openDb } from '../src/db'
import { InteractiveStore } from '../src/interactive/store'
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

it('turns a design system’s tokens into the frame’s theme variables, and refuses unsafe values', () => {
  expect(
    designTokenCss({ colors: { primary: '#7652d4', background: '#ffffff' }, fontSans: 'Inter, sans-serif', radius: 6 }),
  ).toBe('<style>:root{--primary:#7652d4;--background:#ffffff;--font-sans:Inter, sans-serif;--radius:6px}</style>')
  expect(() =>
    parseArtifactSource({
      kind: 'design',
      frames: [{ name: 'A', width: 400, height: 300, html: '' }],
      tokens: { colors: { primary: 'red;}body{' } },
    }),
  ).toThrow('Give colors as hex')
  expect(() =>
    parseArtifactSource({
      kind: 'design',
      frames: [{ name: 'A', width: 400, height: 300, html: '' }],
      tokens: { fontSans: 'x;}</style>' },
    }),
  ).toThrow('Name fonts as a CSS font list')
})

it('draws decks and dashboards with the host’s design system, and lets a design keep its own tokens', async () => {
  const db = openDb(':memory:')
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','P',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','T','current','idle',0); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES('s','t','codex','/tmp','idle',0)",
  )
  const interactive = new InteractiveStore(
    db,
    vi.fn(),
    vi.fn(async () => ({ screenshot: 'data:image/png;base64,AA==', height: 400, checks: [], errors: [] as string[] })),
  )
  interactive.designSystem = () => ({ colors: { primary: '#ff5500' } })
  const deck = await interactive.preview('s', {
    kind: 'slides',
    slides: [{ layout: 'title', title: 'Hello' }],
    title: 'Deck',
    summary: 'D',
    checks: [],
  } as never)
  expect(interactive.get('s', interactive.publish('s', deck.id, 'r1').id, 1).html).toContain('--primary:#ff5500')
  const own = await interactive.preview('s', {
    kind: 'design',
    frames: [{ name: 'A', width: 400, height: 300, html: '<p>x</p>' }],
    tokens: { colors: { primary: '#00aa00' } },
    title: 'System',
    summary: 'S',
    checks: [],
  } as never)
  const html = interactive.get('s', interactive.publish('s', own.id, 'r2').id, 1).html
  expect(html).toContain('--primary:#00aa00')
  expect(html).not.toContain('--primary:#ff5500')
  db.close()
})
