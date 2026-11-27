import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PUSH_CATEGORIES,
  isCategoryOn,
  parseSwitched,
  registerCategories,
  withCategory,
} from '../src/runtime/pushCategories.ts'

test('everything is on until something is switched off', () => {
  for (const category of PUSH_CATEGORIES) assert.equal(isCategoryOn(undefined, category), true)
  assert.deepEqual(registerCategories(undefined), [])
  assert.deepEqual(registerCategories(''), [])
})

test('switching a category off and on again round-trips', () => {
  const off = withCategory('', 'done', false)
  assert.equal(isCategoryOn(off, 'done'), false)
  assert.equal(isCategoryOn(off, 'input'), true)
  assert.deepEqual(registerCategories(off), [['input', 'failed', 'scheduled', 'artifacts']])
  assert.equal(withCategory(off, 'done', true), '')
  assert.deepEqual(registerCategories(withCategory(off, 'done', true)), [])
})

test('muting twice does not duplicate, and the order is stable', () => {
  const text = withCategory(withCategory(withCategory('', 'scheduled', false), 'input', false), 'scheduled', false)
  assert.equal(text, 'input,scheduled')
})

test('unknown or stale stored values are ignored', () => {
  assert.deepEqual(parseSwitched('digest,done,,nonsense'), ['done'])
  assert.deepEqual(registerCategories('nonsense'), [])
})
