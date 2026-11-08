import { afterEach, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { InteractiveStore, type InteractiveInput } from '../src/interactive/store'
import { PageStore } from '../src/interactive/pages'
import { cleanSvg } from '../src/interactive/svg'
import { renderArtifactSource } from '../src/interactive/kinds'
import { restyleArtifact } from '../src/interactive/restyle'
import { parseArtifactSource } from '@ramu/shared/artifactSource'
import { editableSource } from '@ramu/shared/artifacts'

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

function setup() {
  const db = openDb(':memory:')
  databases.push(db)
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','P',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','T','current','idle',0); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES('s','t','codex','/tmp','idle',0)",
  )
  const interactive = new InteractiveStore(db, vi.fn(), previewer)
  return { interactive, pages: new PageStore(db, interactive) }
}
const doc = (source: string): InteractiveInput => ({
  kind: 'doc',
  source,
  title: 'Launch plan',
  summary: 'The plan',
  checks: [],
})

it('publishes a doc drawn from Markdown, with anchors, tables and its Mermaid blocks, and keeps its source', async () => {
  const { interactive, pages } = setup()
  const markdown =
    '## Goals\n\nSee [risks](#risks) <script>alert(1)</script>\n\n| Step | Owner |\n| --- | --- |\n| Ship | Ana |\n\n```mermaid\nflowchart LR\n  A[Plan] --> B[Ship]\n```\n\n## Risks\n\nNone.\n'
  const preview = await interactive.preview('s', doc(markdown))
  expect(preview.errors).toEqual([])
  const html = previewer.mock.calls.at(-1)![0]
  expect(html).toContain('<h2 id="goals">Goals</h2>')
  expect(html).toContain('<table class="table">')
  expect(html).toContain('pele-flowchart')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('language-mermaid')
  const reference = interactive.publish('s', preview.id, 'r1')
  expect(reference).toMatchObject({ kind: 'doc', files: ['document.md'], network: { resources: [], connect: [] } })
  const kept = pages.keep('s', reference.id, { title: 'Launch plan' })
  expect(kept.kind).toBe('doc')
  expect(pages.document(kept.id).files).toEqual([{ path: 'document.md', content: markdown }])
  expect(pages.duplicate(kept.id).kind).toBe('doc')
})

it('fails a doc preview when a heading cannot be reached', async () => {
  const { interactive } = setup()
  const preview = await interactive.preview('s', doc('## Risks\n\ntext\n\n## Risks\n\n##\n\n[gone](#missing)\n'))
  expect(preview.errors).toEqual([
    'Two headings share the anchor #risks ("Risks"). Give one a different name.',
    'Heading 3 is empty. Give it text or remove it.',
    'The link to #missing has no heading or note to go to.',
  ])
  expect(() => interactive.publish('s', preview.id, 'r1')).toThrow(/Fix preview errors/)
})

it('publishes a Mermaid diagram with its drawing, and fails one that does not parse', async () => {
  const { interactive } = setup()
  const source = 'sequenceDiagram\n  Phone->>Host: Sync\n  Host-->>Phone: Done'
  const good = await interactive.preview('s', {
    kind: 'diagram',
    format: 'mermaid',
    source,
    title: 'Sync',
    summary: 'How sync works',
    checks: [],
  })
  expect(good.errors).toEqual([])
  const reference = interactive.publish('s', good.id, 'r1')
  expect(reference).toMatchObject({ kind: 'diagram', files: ['diagram.mmd', 'diagram.svg'] })
  const files = interactive.get('s', reference.id, 1).files!
  expect(files[0]).toEqual({ path: 'diagram.mmd', content: source })
  expect(files[1]!.content).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]*pele-sequence/)

  const bad = await interactive.preview('s', {
    kind: 'diagram',
    format: 'mermaid',
    source: 'flowchart LR\n  A -->',
    title: 'Broken',
    summary: 'Does not parse',
    checks: [],
  })
  expect(bad.errors[0]).toMatch(/^The diagram does not parse: Parse error on line 2/)
  expect(() => interactive.publish('s', bad.id, 'r2')).toThrow(/Fix preview errors/)
})

it('checks each kind’s source before drawing it', async () => {
  const { interactive } = setup()
  const base = { title: 'X', summary: 'Y', checks: [] }
  await expect(interactive.preview('s', { ...base, kind: 'diagram', source: 'flowchart LR' })).rejects.toThrow(
    'Say which the diagram is written in: format "mermaid" or "svg".',
  )
  await expect(interactive.preview('s', { ...base, kind: 'doc', source: '  ' })).rejects.toThrow(
    'Write the doc as Markdown in source.',
  )
  await expect(interactive.preview('s', { ...base, kind: 'doc', source: '# Hi', html: '<p>x</p>' })).rejects.toThrow(
    'html and files are for apps',
  )
  await expect(interactive.preview('s', { ...base, source: '# Hi' })).rejects.toThrow(
    'Set kind to doc, diagram, slides or dashboard',
  )
  await expect(
    interactive.preview('s', { ...base, kind: 'diagram', format: 'svg', source: '<p>not svg</p>' }),
  ).rejects.toThrow('An SVG diagram needs an <svg> element.')
})

it('fails an SVG diagram that would run script or load from elsewhere', async () => {
  const { interactive } = setup()
  const preview = await interactive.preview('s', {
    kind: 'diagram',
    format: 'svg',
    source: '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" width="5" height="5"/></svg>',
    title: 'Unsafe',
    summary: 'Has a script',
    checks: [],
  })
  expect(preview.errors).toEqual([
    'The SVG uses <script> elements, onclick attributes, which diagrams do not allow. Remove them.',
  ])
})

it('keeps only drawing elements and plain attributes in SVG', () => {
  expect(
    cleanSvg(
      '<?xml version="1.0"?><svg viewBox="0 0 10 10"><a href="https://example.com"><rect/></a><use href="#dot"/><style>g > rect { fill: red }</style><rect style="fill:url(https://example.com/x.png)"/><circle fill="url(#g)" r="2"/>A &amp; B</svg>',
    ),
  ).toEqual({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="#dot"/><style>g &gt; rect { fill: red }</style><rect/><circle fill="url(#g)" r="2"/>A &amp; B</svg>',
    removed: ['<a> elements', 'style values that load from elsewhere'],
  })
  expect(() => cleanSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).toThrow('Remove the <!DOCTYPE>')
  expect(() => cleanSvg('<svg><g></svg>')).toThrow('The SVG closes </svg> where <g> is open.')
  expect(() => cleanSvg('<svg/><svg/>')).toThrow('Put everything inside one <svg> element.')
})

it('saves the person’s own edit of a doc as a new version, and refuses one made on an older version', async () => {
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', doc('## Goals\n\nShip sync.\n'))
  const kept = pages.keep('s', interactive.publish('s', preview.id, 'r1').id, { title: 'Launch plan' })
  const source = parseArtifactSource({ kind: 'doc', source: '## Goals\n\nShip sync on Friday.\n' })
  const drawn = await renderArtifactSource(source, 'Launch plan')
  const edited = pages.saveEdit(kept.id, 1, drawn)
  expect(edited.version).toBe(2)
  const document = pages.document(kept.id)
  expect(document.reference.changes).toBe('Edited by you')
  expect(document.files).toEqual([{ path: 'document.md', content: '## Goals\n\nShip sync on Friday.\n' }])
  expect(() => pages.saveEdit(kept.id, 1, drawn)).toThrow('it is now at v2')
})

it('marks an edit with the device it was made on', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', doc('## Goals\n\nShip sync.\n'))
  const kept = pages.keep('s', interactive.publish('s', preview.id, 'r1').id, { title: 'Launch plan' })
  let caller: string | undefined = 'Ayu’s iPhone'
  const methods = registerArtifactHandlers({
    pages,
    pageAi: {},
    activity: { run: () => {} },
    host: { callerName: () => caller },
  } as never)
  await methods['artifacts.editSource']!.run(kept.id, 1, '## Goals\n\nShip sync on Friday.\n')
  expect(pages.document(kept.id).reference.changes).toBe('Edited by you on Ayu’s iPhone')
  caller = undefined
  await methods['artifacts.editSource']!.run(kept.id, 2, '## Goals\n\nShip sync on Monday.\n')
  expect(pages.document(kept.id).reference.changes).toBe('Edited by you')
})

it('merges an edit made from an earlier version on another device, and refuses one that changed the same lines', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', doc('## Goals\n\nShip sync.\n\n## Owner\n\nAyu\n'))
  const kept = pages.keep('s', interactive.publish('s', preview.id, 'r1').id, { title: 'Launch plan' })
  let caller = 'Ayu’s iPhone'
  const methods = registerArtifactHandlers({
    pages,
    pageAi: {},
    activity: { run: () => {} },
    host: { callerName: () => caller },
  } as never)
  // The phone saves first; the desktop's edit started from v1 too and changed another line.
  await methods['artifacts.editSource']!.run(kept.id, 1, '## Goals\n\nShip sync on Friday.\n\n## Owner\n\nAyu\n')
  caller = 'MacBook'
  const merged = (await methods['artifacts.editSource']!.run(
    kept.id,
    1,
    '## Goals\n\nShip sync.\n\n## Owner\n\nAyu and Bo\n',
  )) as { version: number }
  expect(merged.version).toBe(3)
  const document = pages.document(kept.id)
  expect(document.files?.[0]?.content).toBe('## Goals\n\nShip sync on Friday.\n\n## Owner\n\nAyu and Bo\n')
  expect(document.reference.changes).toBe('Edited by you on MacBook, merged with v2')
  await expect(
    methods['artifacts.editSource']!.run(kept.id, 1, '## Goals\n\nShip sync on Monday.\n\n## Owner\n\nAyu\n'),
  ).rejects.toThrow('in the same lines you changed')
})

it('lets the person an editing link names edit the text, merged and marked with their name, and no other link', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', doc('## Goals\n\nShip sync.\n'))
  const kept = pages.keep('s', interactive.publish('s', preview.id, 'r1').id, { title: 'Launch plan' })
  const methods = registerArtifactHandlers({
    pages,
    pageAi: {},
    activity: { run: () => {} },
    host: { callerName: () => 'MacBook' },
  } as never)
  const editing = (await methods['artifacts.share']!.run(kept.id, false, 'Bo')) as { token: string; editor?: string }
  expect(editing.editor).toBe('Bo')
  const reading = (await methods['artifacts.share']!.run(kept.id, false)) as { token: string }
  await methods['artifacts.shareEditSource']!.run(editing.token, 1, '## Goals\n\nShip sync on Friday.\n')
  expect(pages.document(kept.id).reference.changes).toBe('Edited by Bo')
  await expect(
    Promise.resolve().then(() => methods['artifacts.shareEditSource']!.run(reading.token, 2, 'x')),
  ).rejects.toThrow('does not allow editing')
  expect(await methods['artifacts.shareEditing']!.run(editing.token, true)).toEqual([])
  pages.revokeShare(editing.token)
  await expect(
    Promise.resolve().then(() => methods['artifacts.shareEditSource']!.run(editing.token, 2, 'y')),
  ).rejects.toThrow('expired or was revoked')
})

it('tells each device which others are editing the same text, until they stop or go quiet', async () => {
  const { EditingPresence } = await import('../src/interactive/editing')
  let now = 0
  const presence = new EditingPresence(() => now)
  expect(presence.mark('a1', 'MacBook', true)).toEqual([])
  expect(presence.mark('a1', 'iPhone', true)).toEqual(['MacBook'])
  presence.mark('a1', 'MacBook', false)
  expect(presence.mark('a1', 'iPhone', true)).toEqual([])
  presence.mark('a1', 'MacBook', true)
  now = 100_000
  // The desktop said nothing for more than ninety seconds, so it no longer counts.
  expect(presence.mark('a1', 'iPhone', true)).toEqual([])
})

it('saves the person’s words in a design’s frames, keeping its markup and styles', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', {
    kind: 'design',
    frames: [{ name: 'Hero', width: 800, height: 400, html: '<h1>Old line</h1><p>Keep</p>', css: 'h1{color:red}' }],
    title: 'Hero',
    summary: 'H',
    checks: [],
  } as never)
  const kept = pages.keep('s', interactive.publish('s', preview.id, 'r1').id, { title: 'Hero' })
  const methods = registerArtifactHandlers({ pages, pageAi: {}, activity: { run: () => {} }, host: {} } as never)
  await methods['artifacts.editDesign']!.run(kept.id, 1, [['New line', 'Keep']])
  const stored = JSON.parse(pages.document(kept.id).files!.find((file) => file.path === 'design.json')!.content)
  expect(stored.frames[0]).toMatchObject({ html: '<h1>New line</h1><p>Keep</p>', css: 'h1{color:red}' })
  expect(pages.document(kept.id).reference.changes).toBe('Edited by you')
  await expect(methods['artifacts.editDesign']!.run(kept.id, 2, [['Only one']])).rejects.toThrow('changed while')
})

it('tells the host’s devices which slide a deck is on, and only for a deck', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const send = vi.fn()
  let kind = 'slides'
  const methods = registerArtifactHandlers({
    pages: { get: () => ({ kind }) },
    pageAi: {},
    activity: { run: () => {} },
    host: { send },
  } as never)
  const id = '00000000-0000-4000-8000-000000000001'
  methods['artifacts.turnSlide']!.run(id, 3)
  expect(send).toHaveBeenCalledWith('artifacts:slide', { artifactId: id, index: 3 })
  kind = 'doc'
  expect(() => methods['artifacts.turnSlide']!.run(id, 0)).toThrow('Only a deck')
})

it('gives a dashboard’s first figure to the home-screen widget, with the next ones as lines', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const { LiveDashboards } = await import('../src/interactive/liveDashboard')
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', {
    kind: 'dashboard',
    datasets: [
      {
        id: 'w',
        columns: ['week', 'signups', 'active'],
        rows: [
          ['W1', 3, 10],
          ['W2', 4, 12],
        ],
      },
    ],
    figures: [
      { label: 'Signups', dataset: 'w', column: 'signups' },
      { label: 'Active', dataset: 'w', column: 'active', aggregate: 'last', unit: ' people' },
    ],
    title: 'Growth',
    summary: 'G',
    checks: [],
  } as never)
  const kept = pages.keep('s', interactive.publish('s', preview.id, 'r1').id, { title: 'Growth' })
  const methods = registerArtifactHandlers({
    pages,
    pageAi: {},
    activity: { run: () => {} },
    host: {},
    liveDashboards: new LiveDashboards(async () => []),
  } as never)
  expect(await methods['artifacts.widget']!.run(kept.id)).toEqual({
    title: 'Signups',
    value: '7',
    items: ['Active: 12 people'],
  })
})

it('edits a Mermaid diagram’s source in place, and offers no text to edit for an SVG diagram', async () => {
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', {
    kind: 'diagram',
    format: 'mermaid',
    source: 'flowchart LR\n  A[Plan] --> B[Ship]',
    title: 'Flow',
    summary: 'F',
    checks: [],
  })
  const kept = pages.keep('s', interactive.publish('s', preview.id, 'r1').id, { title: 'Flow' })
  expect(editableSource(pages.document(kept.id))).toBe('flowchart LR\n  A[Plan] --> B[Ship]')
  const source = parseArtifactSource({
    kind: 'diagram',
    format: 'mermaid',
    source: 'flowchart LR\n  A[Plan] --> B[Launch]',
  })
  pages.saveEdit(kept.id, 1, await renderArtifactSource(source, 'Flow'))
  expect(editableSource(pages.document(kept.id))).toContain('B[Launch]')
  expect(pages.document(kept.id).html).toContain('Launch')
  expect(
    editableSource({ reference: { kind: 'diagram' }, files: [{ path: 'diagram.svg', content: '<svg/>' }] }),
  ).toBeNull()
})

it('keeps an artifact as a template without its values, and starts new artifacts from it', async () => {
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', doc('## Weekly report\n\nWhat shipped.\n'))
  const kept = pages.keep('s', interactive.publish('s', preview.id, 'r1').id, { title: 'Weekly report' })
  const template = pages.saveTemplate(kept.id)
  expect(pages.templates()).toEqual([expect.objectContaining({ id: template.id, kind: 'doc', title: 'Weekly report' })])
  const made = pages.fromTemplate(template.id)
  expect(made.id).not.toBe(kept.id)
  expect(made.version).toBe(1)
  expect(made.kind).toBe('doc')
  expect(pages.document(made.id).files).toEqual(pages.document(kept.id).files)
  expect(pages.state(made.id).state).toBeNull()
  pages.removeTemplate(template.id)
  expect(pages.templates()).toEqual([])
  expect(() => pages.fromTemplate(template.id)).toThrow('That template was removed.')
})

it('restyles a deck with the host’s design system as a new version, and needs one chosen first', async () => {
  const { interactive, pages } = setup()
  const system = await interactive.preview('s', {
    kind: 'design',
    frames: [{ name: 'Tokens', width: 400, height: 300, html: '<p>Aa</p>' }],
    tokens: { colors: { primary: '#ff5500' } },
    title: 'Brand',
    summary: 'B',
    checks: [],
  } as never)
  const brand = pages.keep('s', interactive.publish('s', system.id, 'r1').id, { title: 'Brand' })
  const deck = await interactive.preview('s', {
    kind: 'slides',
    slides: [{ layout: 'title', title: 'Hello' }],
    title: 'Deck',
    summary: 'D',
    checks: [],
  } as never)
  const kept = pages.keep('s', interactive.publish('s', deck.id, 'r2').id, { title: 'Deck' })
  await expect(restyleArtifact(pages, kept.id, 1, null)).rejects.toThrow('Choose a design system first')
  const restyled = await restyleArtifact(pages, kept.id, 1, brand.id)
  expect(restyled.version).toBe(2)
  const document = pages.document(kept.id)
  expect(document.reference.changes).toBe('Restyled with Brand')
  expect(document.html).toContain('--primary:#ff5500')
})

it('keeps an artifact another host shared as a template here, ready to start new artifacts from', async () => {
  const { interactive, pages } = setup()
  const preview = await interactive.preview('s', doc('## Weekly\n\nNotes.\n'))
  const shared = interactive.get('s', interactive.publish('s', preview.id, 'r1').id, 1)
  const template = pages.saveTemplateFrom(shared, { title: 'Weekly from the studio', icon: '📝' })
  expect(template).toMatchObject({ kind: 'doc', title: 'Weekly from the studio' })
  expect(pages.list()).toEqual([])
  const made = pages.fromTemplate(template.id)
  expect(pages.document(made.id).files).toEqual([{ path: 'document.md', content: '## Weekly\n\nNotes.\n' }])
})
