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
it('exports exact raw bytes separately from a runnable snapshot and uses a safe filename', () => {
  expect(interactiveExport(document, null, true)).toEqual({
    name: 'interactive-content-v2-source.html',
    html: document.html,
    mimeType: 'text/html',
  })
  const runnable = interactiveExport(document, { controls: [], custom: { step: 3 } })
  expect(runnable.html).toContain(document.html)
  expect(runnable.html).toContain('"step":3')
  expect(runnable.html).toContain('Content-Security-Policy')
  expect(interactiveExport(document, { custom: 'invalid' }).html).toContain('initial=null')
})
