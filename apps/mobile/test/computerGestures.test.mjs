import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampPan, pinchZoom, screenPoint, screenRect } from '../src/runtime/computerGestures.ts'

const area = { width: 400, height: 600 }
const screen = { width: 1600, height: 1000 }

test('a wide screen fits the viewer width and sits centred', () => {
  assert.deepEqual(screenRect(area, screen, 1, { x: 0, y: 0 }), { left: 0, top: 175, width: 400, height: 250 })
})

test('touches map to remote pixels, and the bars around the screen do nothing', () => {
  const rect = screenRect(area, screen, 1, { x: 0, y: 0 })
  assert.deepEqual(screenPoint({ x: 200, y: 300 }, rect, screen), { x: 800, y: 500 })
  assert.equal(screenPoint({ x: 200, y: 100 }, rect, screen), null)
})

test('zoom and pan move the mapping with the picture', () => {
  const pan = clampPan(area, screen, 2, { x: 500, y: 0 })
  assert.deepEqual(pan, { x: 200, y: 0 })
  const rect = screenRect(area, screen, 2, pan)
  assert.deepEqual(screenPoint({ x: 0, y: 300 }, rect, screen), { x: 0, y: 500 })
  assert.deepEqual(clampPan(area, screen, 1, { x: 50, y: 50 }), { x: 0, y: 0 })
})

test('pinching zooms between fit and four times', () => {
  assert.equal(pinchZoom(1, 100, 200), 2)
  assert.equal(pinchZoom(2, 100, 10), 1)
  assert.equal(pinchZoom(3, 100, 300), 4)
})
