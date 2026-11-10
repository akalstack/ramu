import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finishFolderPick, pickFolder } from '../src/runtime/folderPick.ts'

test('a folder chosen in the browser answers the sheet that opened it, once', async () => {
  let opened = 0
  const picked = pickFolder(() => opened++)
  assert.equal(opened, 1)
  finishFolderPick('/Users/me/work')
  finishFolderPick(null)
  assert.equal(await picked, '/Users/me/work')
})

test('leaving without choosing, or a newer pick, answers null', async () => {
  const first = pickFolder(() => {})
  const second = pickFolder(() => {})
  assert.equal(await first, null)
  finishFolderPick(null)
  assert.equal(await second, null)
})
