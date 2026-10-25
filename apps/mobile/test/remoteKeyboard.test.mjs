import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEYBOARD_SENTINEL, keyboardFor, remoteKeys } from '../src/runtime/remoteKeyboard.ts'

test('typing sends only what was added', () => {
  assert.deepEqual(remoteKeys('', 'h'), [{ kind: 'text', text: 'h' }])
  assert.deepEqual(remoteKeys('he', 'hello'), [{ kind: 'text', text: 'llo' }])
})

test('deleting and autocorrect become backspaces, then the replacement', () => {
  assert.deepEqual(remoteKeys('hel', 'he'), [{ kind: 'key', key: 'Backspace' }])
  assert.deepEqual(remoteKeys('teh', 'the '), [
    { kind: 'key', key: 'Backspace' },
    { kind: 'key', key: 'Backspace' },
    { kind: 'text', text: 'he ' },
  ])
})

test('emoji count as one character and new lines press Enter', () => {
  assert.deepEqual(remoteKeys('a👍', 'a'), [{ kind: 'key', key: 'Backspace' }])
  assert.deepEqual(remoteKeys('', 'a\nb'), [
    { kind: 'text', text: 'a' },
    { kind: 'key', key: 'Enter' },
    { kind: 'text', text: 'b' },
  ])
})

test('the keyboard matches the focused field', () => {
  assert.equal(keyboardFor('password').secureTextEntry, true)
  assert.equal(keyboardFor('email').keyboardType, 'email-address')
  assert.equal(keyboardFor('url').returnKeyType, 'go')
  assert.equal(keyboardFor('multiline').multiline, true)
  assert.equal(keyboardFor(undefined).keyboardType, 'default')
})

test('deleting the sentinel of an empty field still sends Backspace', () => {
  assert.deepEqual(remoteKeys(KEYBOARD_SENTINEL, ''), [{ kind: 'key', key: 'Backspace' }])
  assert.deepEqual(remoteKeys(KEYBOARD_SENTINEL, `${KEYBOARD_SENTINEL}a`), [{ kind: 'text', text: 'a' }])
})
