import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duplicateName, explorerActions, parentFolder, planMove, planRename } from '../src/runtime/explorerActions.ts'

test('copying a path is always offered; changes need a reachable host and a device that is not view-only', () => {
  assert.deepEqual(explorerActions({ online: true, viewOnly: false, kind: 'file' }), [
    'copy-path',
    'copy-contents',
    'share',
    'duplicate',
    'move',
    'rename',
    'delete',
  ])
  assert.deepEqual(explorerActions({ online: true, viewOnly: false, kind: 'dir' }), [
    'copy-path',
    'duplicate',
    'move',
    'rename',
    'delete',
  ])
  assert.deepEqual(explorerActions({ online: false, viewOnly: false, kind: 'file' }), ['copy-path'])
  assert.deepEqual(explorerActions({ online: true, viewOnly: true, kind: 'file' }), [
    'copy-path',
    'copy-contents',
    'share',
  ])
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

test('a duplicate takes the first free copy name in its folder', () => {
  assert.equal(duplicateName('src/a.ts', ['a.ts']), 'src/a copy.ts')
  assert.equal(duplicateName('src/a.ts', ['a.ts', 'a copy.ts', 'a copy 2.ts']), 'src/a copy 3.ts')
  assert.equal(duplicateName('.env', ['.env']), '.env copy')
  assert.equal(duplicateName('docs', ['docs']), 'docs copy')
})

test('a move keeps the name, and never lands in the same folder or inside itself', () => {
  assert.deepEqual(planMove('src/a.ts', 'lib'), { ok: true, destination: 'lib/a.ts' })
  assert.deepEqual(planMove('src/a.ts', ''), { ok: true, destination: 'a.ts' })
  assert.deepEqual(planMove('src/a.ts', 'src'), { ok: false, reason: 'same-folder' })
  assert.deepEqual(planMove('a.ts', ''), { ok: false, reason: 'same-folder' })
  assert.deepEqual(planMove('src', 'src'), { ok: false, reason: 'into-itself' })
  assert.deepEqual(planMove('src', 'src/deep'), { ok: false, reason: 'into-itself' })
})
