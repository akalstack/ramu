import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

// The function has no imports of its own; the transcript module around it needs the app.
const source = readFileSync(new URL('../src/runtime/transcript.ts', import.meta.url), 'utf8')
const body = source.slice(
  source.indexOf('export function readableText'),
  source.indexOf('export function deliveryBaseline'),
)
const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { readableText } = await import(`data:text/javascript,${encodeURIComponent(js)}`)

test('a selection reads as the message looks, without Markdown marks', () => {
  assert.equal(
    readableText('## Plan\n\nUse **bold**, `code` and [a link](https://x.dev).'),
    'Plan\n\nUse bold, code and a link.',
  )
  assert.equal(readableText('```ts\nconst a = 1\n```'), 'const a = 1')
  assert.equal(readableText('> quoted\n- item'), 'quoted\n- item')
  assert.equal(readableText('snake_case_name stays *emphasis* gone'), 'snake_case_name stays emphasis gone')
})
