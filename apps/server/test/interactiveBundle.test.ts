import { expect, it } from 'vitest'
import { bundleInteractive } from '../src/interactive/bundle'
import { openDb } from '../src/db'
import { InteractiveStore } from '../src/interactive/store'
import { interactiveBrowserPath, previewInteractive } from '../src/interactive/preview'

const project = [
  {
    path: 'index.html',
    content:
      '<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"><link rel="icon" href="icon.png"></head><body><img src="art/moon.svg" alt="Moon"><a href="https://example.com">x</a><script src="js/state.js"></script><script src="./js/app.js"></script><script>document.body.innerHTML += \'<img src="sprites/run.png">\'</script></body></html>',
  },
  {
    path: 'styles/main.css',
    content: '@import "base.css"; body { background: url(../art/sky.png) }',
  },
  { path: 'styles/base.css', content: 'h1 { color: var(--primary) }' },
  { path: 'art/moon.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  { path: 'art/sky.png', content: 'iVBORw0KGgo=', encoding: 'base64' as const },
  { path: 'icon.png', content: 'AA==', encoding: 'base64' as const },
  { path: 'js/state.js', content: 'window.story = { scene: 1 }' },
  { path: 'js/app.js', content: 'document.title = "</script>" + story.scene' },
]

it('inlines stylesheets, imports, classic scripts and assets into one document', () => {
  const html = bundleInteractive(project)
  expect(html).not.toContain('styles/main.css')
  expect(html).toContain('h1 { color: var(--primary) }')
  expect(html).toContain('url(data:image/png;base64,iVBORw0KGgo=)')
  expect(html).toContain('src="data:image/svg+xml;base64,')
  expect(html).toContain('<script>window.story = { scene: 1 }</script>')
  // Closing tags inside inlined code cannot end the script early.
  expect(html).toContain('document.title = "<\\/script>" + story.scene')
  expect(html).toContain('href="https://example.com"')
  expect(html).not.toContain('icon.png')
  // Markup inside JavaScript strings is left alone.
  expect(html).toContain('<img src="sprites/run.png">')
  expect(html.indexOf('window.story')).toBeLessThan(html.indexOf('document.title'))
})

it('leaves code samples and textarea markup alone', () => {
  const html = bundleInteractive([
    {
      path: 'index.html',
      content: '<textarea aria-label="HTML"><img src="x.png"></textarea><script src="app.js"></script>',
    },
    { path: 'app.js', content: "const sample = `\nimport React from 'react'\nexport default App`" },
  ])
  expect(html).toContain('<textarea aria-label="HTML"><img src="x.png"></textarea>')
  expect(html).toContain("import React from 'react'")
})

it('rejects unsafe paths, missing references and module imports with actionable errors', () => {
  expect(() => bundleInteractive([{ path: '../index.html', content: '' }])).toThrow('Invalid file path')
  expect(() => bundleInteractive([{ path: 'app.js', content: '' }])).toThrow('Entry file index.html is missing')
  expect(() => bundleInteractive([{ path: 'index.html', content: '<script src="missing.js"></script>' }])).toThrow(
    'no file missing.js',
  )
  expect(() => bundleInteractive([{ path: 'index.html', content: '<img src="../../etc/passwd">' }])).toThrow(
    'outside the project',
  )
  expect(() =>
    bundleInteractive([
      { path: 'index.html', content: '<script type="module" src="app.js"></script>' },
      { path: 'app.js', content: '' },
    ]),
  ).toThrow('as a module')
})

it('previews and publishes the bundle while keeping exact project sources for revision', async () => {
  const db = openDb(':memory:')
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','P',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','T','current','idle',0); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES('s','t','codex','/tmp','idle',0)",
  )
  let previewed = ''
  const store = new InteractiveStore(
    db,
    () => {},
    async (html) => {
      previewed = html
      return { screenshot: 'data:image/png;base64,AA==', height: 400, checks: [], errors: [] }
    },
  )
  const files = [...project].reverse()
  await expect(store.preview('s', { title: 'Story', summary: 'A story.', checks: [] })).rejects.toThrow(
    'either html or files',
  )
  const preview = await store.preview('s', { title: 'Story', summary: 'A story.', checks: [], files })
  expect(previewed).toContain('window.story')
  const reference = store.publish('s', preview.id, 'project')
  expect(reference.files?.[0]).toBe('index.html')
  const document = store.get('s', reference.id, 1)
  expect(document.html).toBe(previewed)
  expect(document.files?.find((file) => file.path === 'art/sky.png')).toEqual(project[4])
  db.close()
})

it.skipIf(!interactiveBrowserPath())(
  'runs a bundled project in the isolated preview browser',
  async () => {
    const html = bundleInteractive([
      {
        path: 'index.html',
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="app.css"></head><body><button id="go">Next scene</button><output id="out">Scene 1</output><script src="state.js"></script><script src="app.js"></script></body></html>',
      },
      { path: 'app.css', content: 'body { background: url(bg.svg) }' },
      { path: 'bg.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' },
      { path: 'state.js', content: 'window.scenes = ["Scene 1", "Scene 2"]' },
      { path: 'app.js', content: 'go.onclick = () => { out.textContent = scenes[1] }' },
    ])
    const result = await previewInteractive(html, [{ action: 'click', label: 'Next scene', expect: 'Scene 2' }])
    expect(result.errors).toEqual([])
    expect(result.checks[0]?.passed).toBe(true)
  },
  30_000,
)
