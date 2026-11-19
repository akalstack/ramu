import { test } from 'node:test'
import assert from 'node:assert/strict'
import { terminalKeyGroups, terminalKeySequence } from '../src/runtime/terminalKeys.ts'

test('expanded terminal keys encode editing, navigation and function keys', () => {
  assert.equal(terminalKeySequence('enter'), '\r')
  assert.equal(terminalKeySequence('backspace'), '\x7f')
  assert.equal(terminalKeySequence('delete'), '\x1b[3~')
  assert.equal(terminalKeySequence('insert'), '\x1b[2~')
  assert.equal(terminalKeySequence('shift tab'), '\x1b[Z')
  assert.equal(terminalKeySequence('page up'), '\x1b[5~')
  assert.equal(terminalKeySequence('page down'), '\x1b[6~')
  assert.equal(terminalKeySequence('F1'), '\x1bOP')
  assert.equal(terminalKeySequence('F12'), '\x1b[24~')
  assert.equal(terminalKeySequence('\\'), '\\')
  assert.equal(terminalKeySequence('^C'), '\x03')
  assert.equal(terminalKeySequence('constructor'), 'constructor')
  for (const group of terminalKeyGroups) for (const key of group.keys) assert.ok(terminalKeySequence(key).length > 0)
})
test('named arrows and Home/End honor the terminal application-cursor mode', () => {
  assert.equal(terminalKeySequence('left'), '\x1b[D')
  assert.equal(terminalKeySequence('left', true), '\x1bOD')
  assert.equal(terminalKeySequence('home'), '\x1b[H')
  assert.equal(terminalKeySequence('home', true), '\x1bOH')
  assert.equal(terminalKeySequence('end', true), '\x1bOF')
})
