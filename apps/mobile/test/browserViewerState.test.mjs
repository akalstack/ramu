import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTROL_TEXT, controlState, profileLabel, viewerMessage } from '../src/runtime/browserViewerState.ts'

const tab = (over = {}) => ({ controller: 'human', paused: false, generation: 3, inputReady: true, ...over })
const context = (over = {}) => ({ online: true, active: true, ownedGeneration: 3, ...over })

test('names the kind of profile and whether sign-ins are shared', () => {
  assert.match(profileLabel('temporary'), /not shared/)
  assert.match(profileLabel('default'), /Default profile · shared/)
  assert.match(profileLabel('5b2f0a34-1111-4111-8111-111111111111'), /Named profile · shared/)
})

test('control state never implies control the phone does not hold', () => {
  assert.equal(controlState(tab(), context()), 'yours')
  assert.equal(controlState(tab({ inputReady: false }), context()), 'settling')
  assert.equal(controlState(tab({ generation: 2 }), context()), 'viewing')
  assert.equal(controlState(tab({ controller: 'none' }), context()), 'viewing')
  assert.equal(controlState(tab({ controller: 'agent' }), context()), 'agent')
  assert.equal(controlState(tab(), context({ ownedGeneration: null })), 'viewing')
})

test('a disconnect, background or offline host takes priority and is never handed back automatically', () => {
  assert.equal(controlState(tab({ paused: true }), context()), 'disconnected')
  assert.equal(controlState(tab({ paused: true, controller: 'agent' }), context()), 'disconnected')
  assert.equal(controlState(tab(), context({ active: false })), 'backgrounded')
  assert.equal(controlState(tab({ paused: true }), context({ online: false })), 'offline')
  for (const text of Object.values(CONTROL_TEXT)) assert.ok(text.length > 5)
})

test('turns host refusals into a next step', () => {
  assert.match(viewerMessage('Browser viewing is not granted for this device and thread. Ask the owning host to grant it in Browser settings.'), /Ask the owner of that computer/)
  assert.match(viewerMessage('Pair this device before requesting browser viewing.'), /Pair this phone/)
  assert.equal(viewerMessage('Wait before requesting another browser frame.'), 'Refreshing…')
  assert.match(viewerMessage('This page is too large to stream. Make the page smaller and try again.'), /too large/)
  assert.equal(viewerMessage('Something else'), 'Something else')
})
