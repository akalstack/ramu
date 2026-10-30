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
  assert.match(
    viewerMessage(
      'Browser viewing is not granted for this device and thread. Ask the owning host to grant it in Browser settings.',
    ),
    /Ask the owner of that computer/,
  )
  assert.match(viewerMessage('Pair this device before requesting browser viewing.'), /Pair this phone/)
  assert.equal(viewerMessage('Wait before requesting another browser frame.'), 'Refreshing…')
  assert.match(viewerMessage('This page is too large to stream. Make the page smaller and try again.'), /too large/)
  assert.equal(viewerMessage('Something else'), 'Something else')
})

import { frameGesture, framePoint, frameScroll } from '../src/runtime/browserViewerState.ts'

test('a touch maps through the real frame aspect, not a fixed 4:3', () => {
  assert.deepEqual(framePoint(100, 100, 200, 2), { x: 0.5, y: 1 })
  assert.deepEqual(framePoint(500, -5, 200, 2), { x: 1, y: 0 })
})
const frame = { width: 200, aspect: 2, pageWidth: 400 }
const at = { x: 50, y: 25, dx: 0, dy: 0, ms: 80, afterTapMs: null }
test('a short touch clicks, a quick second one double-clicks, a held one right-clicks', () => {
  assert.deepEqual(frameGesture(at, frame), { kind: 'click', x: 0.25, y: 0.25, button: 'left', clickCount: 1 })
  assert.equal(frameGesture({ ...at, afterTapMs: 200 }, frame).clickCount, 2)
  assert.equal(frameGesture({ ...at, afterTapMs: 900 }, frame).clickCount, 1)
  assert.equal(frameGesture({ ...at, ms: 700 }, frame).button, 'right')
})
test('dragging scrolls the page with the finger, scaled to the page and bounded', () => {
  assert.deepEqual(frameGesture({ ...at, dy: -50 }, frame), { kind: 'scroll', x: -0, y: 100 })
  assert.equal(frameGesture({ ...at, dy: 9999 }, frame).y, -2000)
})

test('live drag deltas preserve displacement across moves and release without repeating the whole gesture', () => {
  const moves = [-20, -55, -80]
  let previous = 0,
    total = 0
  for (const dy of moves) {
    total += frameScroll(0, dy - previous, frame).y
    previous = dy
  }
  assert.equal(total, 160)
  assert.equal(Math.abs(frameScroll(0, -80 - previous, frame).y), 0)
})

test('the header names a tab by title, then host, then address', async () => {
  const { tabTitle } = await import('../src/runtime/browserViewerState.ts')
  assert.equal(tabTitle(undefined), 'Browser')
  assert.equal(tabTitle({ title: ' Home Assistant ', url: 'http://192.168.1.36:8123/auth' }), 'Home Assistant')
  assert.equal(tabTitle({ title: '', url: 'http://192.168.1.36:8123/auth' }), '192.168.1.36:8123')
  assert.equal(tabTitle({ title: '', url: '' }), 'New tab')
  const say = (text) => `id:${text}`
  assert.equal(tabTitle({ title: 'Downloads', url: 'https://a.test' }, say), 'Downloads')
  assert.equal(tabTitle({ title: '', url: '' }, say), 'id:New tab')
})

test('typed addresses open over https unless a web scheme is given', async () => {
  const { addressUrl } = await import('../src/runtime/browserViewerState.ts')
  assert.equal(addressUrl('  '), null)
  assert.equal(addressUrl('example.com'), 'https://example.com')
  assert.equal(addressUrl('localhost:3000/x'), 'https://localhost:3000/x')
  assert.equal(addressUrl('HTTP://192.168.1.36:8123'), 'HTTP://192.168.1.36:8123')
  assert.equal(addressUrl('javascript:alert(1)'), null)
})

test('the control strip always offers the next step it can take', async () => {
  const { controlAction } = await import('../src/runtime/browserViewerState.ts')
  assert.equal(controlAction('agent'), 'take')
  assert.equal(controlAction('viewing'), 'take')
  assert.equal(controlAction('disconnected'), 'take')
  assert.equal(controlAction('yours'), 'release')
  assert.equal(controlAction('settling'), 'release')
  assert.equal(controlAction('offline'), null)
  assert.equal(controlAction('backgrounded'), null)
})

test('the overflow menu lists only actions that work for this tab and browser', async () => {
  const { browserMenu } = await import('../src/runtime/browserViewerState.ts')
  assert.deepEqual(browserMenu({ hasTab: false, own: false, hostManaged: true, fileInput: false, phonePage: true }), [
    'newTab',
  ])
  assert.deepEqual(browserMenu({ hasTab: true, own: false, hostManaged: false, fileInput: true, phonePage: false }), [
    'newTab',
    'readText',
    'closeTab',
  ])
  assert.deepEqual(browserMenu({ hasTab: true, own: true, hostManaged: true, fileInput: true, phonePage: true }), [
    'paste',
    'hardReload',
    'display',
    'newTab',
    'openOnPhone',
    'readText',
    'upload',
    'downloads',
    'closeTab',
  ])
})

test('the page refits for a new width or the keyboard, never for small jitter', async () => {
  const { fitSize } = await import('../src/runtime/browserViewerState.ts')
  assert.deepEqual(fitSize({ width: 390.4, height: 640.2 }, null), { width: 390, height: 640 })
  assert.equal(fitSize({ width: 392, height: 620 }, { width: 390, height: 640 }), null)
  assert.deepEqual(fitSize({ width: 390, height: 330 }, { width: 390, height: 640 }), { width: 390, height: 330 })
  assert.deepEqual(fitSize({ width: 844, height: 300 }, { width: 390, height: 640 }), { width: 844, height: 300 })
  assert.equal(fitSize({ width: 100, height: 640 }, null), null)
  assert.deepEqual(fitSize({ width: 320, height: 210 }, { width: 320, height: 500 }), { width: 320, height: 210 })
})

test('only a newly opened tab floats over the chat', async () => {
  const { revealedTab } = await import('../src/runtime/browserViewerState.ts')
  assert.equal(revealedTab(null, [{ id: 'a' }]), null)
  assert.equal(revealedTab(new Set(['a']), [{ id: 'a' }]), null)
  assert.equal(revealedTab(new Set(['a']), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 'c')
})

test('zoom steps through the browser ladder and stops at its ends', async () => {
  const { zoomStep } = await import('../src/runtime/browserViewerState.ts')
  assert.equal(zoomStep(1, 1), 1.1)
  assert.equal(zoomStep(1, -1), 0.9)
  assert.equal(zoomStep(3, 1), 3)
  assert.equal(zoomStep(0.5, -1), 0.5)
  assert.equal(zoomStep(1.3, 1), 1.5)
})
