import { expect, it } from 'vitest'
import { interactiveExport } from '../src/interactiveExport'
import type { InteractiveDocument } from '../src/interactive'
const document: InteractiveDocument = {
  reference: {
    id: '../content',
    version: 2,
    sessionId: 's',
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
