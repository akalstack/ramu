import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const module = { exports: {} }
runInNewContext(
  ts.transpileModule(readFileSync(new URL('../src/runtime/shareRows.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { module, exports: module.exports },
)
const { shareRows } = module.exports

test('a rebuilt transcript keeps the objects of rows that did not change', () => {
  const previous = [
    { id: 'u1', kind: 'user', text: 'Fix it' },
    { id: 't1', kind: 'text', text: 'Looking', tools: [{ name: 'Read', done: true }] },
  ]
  const next = [
    { id: 'u1', kind: 'user', text: 'Fix it' },
    { id: 't1', kind: 'text', text: 'Looking at it', tools: [{ name: 'Read', done: true }] },
    { id: 'u2', kind: 'user', text: 'Thanks' },
  ]
  const shared = shareRows(previous, next)
  assert.equal(shared[0], previous[0])
  assert.equal(shared[1], next[1])
  assert.equal(shared[2], next[2])
})

test('an unchanged rebuild returns the previous array, so nothing downstream recomputes', () => {
  const previous = [{ id: 'a', kind: 'text', text: 'x', nested: { list: [1, 2] } }]
  assert.equal(shareRows(previous, [{ id: 'a', kind: 'text', text: 'x', nested: { list: [1, 2] } }]), previous)
})

test('a change deep inside a row, a removed row or a reorder is never hidden', () => {
  const previous = [
    { id: 'a', nested: { list: [1, 2] } },
    { id: 'b', nested: { list: [] } },
  ]
  assert.notEqual(shareRows(previous, [{ id: 'a', nested: { list: [1, 3] } }, previous[1]])[0], previous[0])
  assert.notEqual(shareRows(previous, [previous[0]]), previous)
  const reordered = shareRows(previous, [{ ...previous[1] }, { ...previous[0] }])
  assert.equal(reordered[0], previous[1])
  assert.notEqual(reordered, previous)
})
