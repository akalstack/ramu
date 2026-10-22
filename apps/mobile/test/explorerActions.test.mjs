import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duplicateName, explorerActions, parentFolder, planMove, planRename } from '../src/runtime/explorerActions.ts'

test('copying a path is always offered; changes need a reachable host and a device that is not view-only', () => {
  assert.deepEqual(explorerActions({ online: true, viewOnly: false }), [
    'copy-path',
    'copy-contents',
    'share',
    'duplicate',
    'move',
    'rename',
    'delete',
  ])
  assert.deepEqual(explorerActions({ online: false, viewOnly: false }), ['copy-path'])
  assert.deepEqual(explorerActions({ online: true, viewOnly: false, kind: 'dir' }), [
    'copy-path',
    'duplicate',
    'move',
    'rename',
    'delete',
  ])
  assert.deepEqual(explorerActions({ online: true, viewOnly: true }), ['copy-path', 'copy-contents', 'share'])
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

test('moving keeps the name, targets a folder of the checkout and never into itself', () => {
  assert.deepEqual(planMove('src/a.ts', '/lib/util/'), { ok: true, destination: 'lib/util/a.ts' })
  assert.deepEqual(planMove('src/a.ts', ''), { ok: true, destination: 'a.ts' })
  assert.deepEqual(planMove('src/a.ts', 'src'), { ok: false, reason: 'unchanged' })
  assert.deepEqual(planMove('src', 'src/inner'), { ok: false, reason: 'inside-self' })
  for (const bad of ['../x', 'a/../b', 'a//b', 'a\\b'])
    assert.deepEqual(planMove('a.ts', bad), { ok: false, reason: 'invalid' })
})

test('a duplicate takes the first free sibling name', () => {
  assert.equal(duplicateName('src/a.ts', ['a.ts']), 'src/a copy.ts')
  assert.equal(duplicateName('src/a.ts', ['a.ts', 'a copy.ts']), 'src/a copy 2.ts')
  assert.equal(duplicateName('Makefile', []), 'Makefile copy')
  assert.equal(duplicateName('.env', []), '.env copy')
})
