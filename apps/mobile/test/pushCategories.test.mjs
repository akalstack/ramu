import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PUSH_CATEGORIES,
  isCategoryOn,
  parseSwitched,
  registerCategories,
  withCategory,
} from '../src/runtime/pushCategories.ts'

test('everything is on until something is switched off, except the opt-in daily recap', () => {
  for (const category of PUSH_CATEGORIES) assert.equal(isCategoryOn(undefined, category), category !== 'digest')
  assert.deepEqual(registerCategories(undefined), [])
  assert.deepEqual(registerCategories(''), [])
})

test('the daily recap is off by default and, once on, is sent to the host explicitly', () => {
  assert.equal(isCategoryOn('', 'digest'), false)
  const on = withCategory('', 'digest', true)
  assert.equal(on, 'digest')
  assert.equal(isCategoryOn(on, 'digest'), true)
  assert.deepEqual(registerCategories(on), [['input', 'failed', 'done', 'scheduled', 'digest']])
  // Switching it on does not touch the others, and switching it off again returns to "everything at its default".
  assert.deepEqual(registerCategories(withCategory(on, 'done', false)), [['input', 'failed', 'scheduled', 'digest']])
  assert.equal(withCategory(on, 'digest', false), '')
  assert.deepEqual(registerCategories(withCategory(on, 'digest', false)), [])
  // Muting something else while the digest stays off does not enable it.
  assert.deepEqual(registerCategories(withCategory('', 'done', false)), [['input', 'failed', 'scheduled']])
})

test('switching a category off and on again round-trips', () => {
  const off = withCategory('', 'done', false)
  assert.equal(isCategoryOn(off, 'done'), false)
  assert.equal(isCategoryOn(off, 'input'), true)
  assert.deepEqual(registerCategories(off), [['input', 'failed', 'scheduled']])
  assert.equal(withCategory(off, 'done', true), '')
  assert.deepEqual(registerCategories(withCategory(off, 'done', true)), [])
})

test('muting twice does not duplicate, and the order is stable', () => {
  const text = withCategory(withCategory(withCategory('', 'scheduled', false), 'input', false), 'scheduled', false)
  assert.equal(text, 'input,scheduled')
})

test('unknown or stale stored values are ignored', () => {
  assert.deepEqual(parseSwitched('digest,done,,nonsense'), ['done', 'digest'])
  assert.deepEqual(registerCategories('nonsense'), [])
})
