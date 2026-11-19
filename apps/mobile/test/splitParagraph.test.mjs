import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const module = { exports: {} }
runInNewContext(
  ts.transpileModule(readFileSync(new URL('../src/runtime/markdown.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { module, exports: module.exports, require: () => ({}) },
)
const { splitLongParagraph } = module.exports

test('a normal paragraph stays one piece', () => {
  assert.deepEqual([...splitLongParagraph('A short answer.')], ['A short answer.'])
})

test('a huge paragraph is cut into pieces that keep every word, preferring line breaks', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `log line ${i} with some detail`)
  const text = lines.join('\n')
  const pieces = splitLongParagraph(text)
  assert.ok(pieces.length > 5)
  assert.ok(pieces.every((piece) => piece.length <= 1500))
  assert.deepEqual([...pieces.join('\n').split('\n')], lines)
})

test('a paragraph with no breaks is cut at spaces without losing text', () => {
  const words = Array.from({ length: 1000 }, (_, i) => `word${i}`)
  const pieces = splitLongParagraph(words.join(' '))
  assert.deepEqual(pieces.join(' ').split(/\s+/), words)
})
