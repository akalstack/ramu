import { test } from 'node:test'
import assert from 'node:assert/strict'
import { explorerActions, parentFolder, planRename } from '../src/runtime/explorerActions.ts'

test('copying a path is always offered; changes need a reachable host and a device that is not view-only', () => {
  assert.deepEqual(explorerActions({ online: true, viewOnly: false }), ['copy-path', 'rename', 'delete'])
  assert.deepEqual(explorerActions({ online: false, viewOnly: false }), ['copy-path'])
  assert.deepEqual(explorerActions({ online: true, viewOnly: true }), ['copy-path'])
})

test('a rename stays in its folder and rejects empty, unchanged and path-like names', () => {
  assert.deepEqual(planRename('src/app/a.ts', ' b.ts '), { ok: true, destination: 'src/app/b.ts' })
  assert.deepEqual(planRename('a.ts', 'b.ts'), { ok: true, destination: 'b.ts' })
  assert.deepEqual(planRename('a.ts', '  '), { ok: false, reason: 'empty' })
  assert.deepEqual(planRename('src/a.ts', 'a.ts'), { ok: false, reason: 'unchanged' })
  for (const bad of ['..', '.', 'x/y', 'x\\y', '../etc', 'a'.repeat(256)])
    assert.deepEqual(planRename('src/a.ts', bad), { ok: false, reason: 'invalid' })
})

test('the folder to reload is the parent, or the root for a top-level entry', () => {
  assert.equal(parentFolder('src/app/a.ts'), 'src/app')
  assert.equal(parentFolder('a.ts'), '')
})
