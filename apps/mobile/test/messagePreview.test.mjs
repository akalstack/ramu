import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const module = { exports: {} }
runInNewContext(
  ts.transpileModule(readFileSync(new URL('../src/runtime/messagePreview.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { module, exports: module.exports },
)
const { messagePreview } = module.exports

test('a short message is shown whole', () => {
  assert.equal(messagePreview('Fix the date test\nand run it'), null)
})

test('a long message keeps its first lines', () => {
  const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
  const preview = messagePreview(text)
  assert.equal(preview.split('\n').length, 12)
  assert.ok(preview.startsWith('line 0'))
})

test('a preview that stops inside a code block closes it, so the rest renders as text', () => {
  const text = ['Here is the log:', '```', ...Array.from({ length: 60 }, (_, i) => `entry ${i}`), '```'].join('\n')
  const preview = messagePreview(text)
  assert.ok(preview.endsWith('\n```'))
  assert.equal(preview.split('\n').filter((line) => line.startsWith('```')).length, 2)
})

test('one enormous line is cut by length', () => {
  const preview = messagePreview('x'.repeat(5000))
  assert.ok(preview.length <= 901)
  assert.ok(preview.endsWith('…'))
})
