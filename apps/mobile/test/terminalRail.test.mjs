import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RAIL, RAIL_LIMIT, moveRailKey, parseRail, toggleRailKey } from '../src/runtime/terminalKeys.ts'

test('a missing, corrupt or empty saved rail falls back to the default', () => {
  assert.deepEqual(parseRail(undefined), DEFAULT_RAIL)
  assert.deepEqual(parseRail('not json'), DEFAULT_RAIL)
  assert.deepEqual(parseRail('{"a":1}'), DEFAULT_RAIL)
  assert.deepEqual(parseRail('["nonsense"]'), DEFAULT_RAIL)
})

test('a saved rail keeps only known keys once each, in order, within the limit', () => {
  assert.deepEqual(parseRail(JSON.stringify(['^C', 'bogus', 'esc', '^C', 7])), ['^C', 'esc'])
  const many = JSON.stringify(Array.from({ length: 12 }, (_, i) => `F${i + 1}`).concat(['esc', 'tab', 'enter']))
  assert.equal(parseRail(many).length, 15)
  const all = JSON.stringify([...DEFAULT_RAIL, ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`), 'enter', 'home'])
  assert.equal(parseRail(all).length <= RAIL_LIMIT, true)
})

test('pinning appends, unpinning removes, and the last key and unknown keys stay put', () => {
  assert.deepEqual(toggleRailKey(['esc'], 'F5'), ['esc', 'F5'])
  assert.deepEqual(toggleRailKey(['esc', 'F5'], 'esc'), ['F5'])
  assert.deepEqual(toggleRailKey(['esc'], 'esc'), ['esc'])
  assert.deepEqual(toggleRailKey(['esc'], 'bogus'), ['esc'])
  const full = parseRail(JSON.stringify([...DEFAULT_RAIL, ...Array.from({ length: 9 }, (_, i) => `F${i + 1}`)]))
  assert.equal(full.length, RAIL_LIMIT)
  assert.deepEqual(toggleRailKey(full, 'F10'), full)
})

test('keys move one place and stop at the ends', () => {
  assert.deepEqual(moveRailKey(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(moveRailKey(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'])
  assert.deepEqual(moveRailKey(['a', 'b'], 'a', -1), ['a', 'b'])
  assert.deepEqual(moveRailKey(['a', 'b'], 'zzz', 1), ['a', 'b'])
})
