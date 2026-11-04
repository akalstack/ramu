import { expect, it } from 'vitest'
import { livePlacement, livePosition, liveState, liveSurface } from '../src/liveView'

it('follows computer use, then the first tab, and keeps a pin only while that surface exists', () => {
  const tabs = [
    { id: 'a', host: true },
    { id: 'b', host: false },
  ]
  expect(liveSurface({}, { computer: true, tabs })).toEqual({ kind: 'computer' })
  expect(liveSurface({}, { computer: false, tabs })).toEqual({ kind: 'browser', tabId: 'a', host: true })
  expect(liveSurface({ pinned: { kind: 'browser', tabId: 'b', host: false } }, { computer: true, tabs })).toEqual({
    kind: 'browser',
    tabId: 'b',
    host: false,
  })
  expect(
    liveSurface({ pinned: { kind: 'browser', tabId: 'gone', host: true } }, { computer: false, tabs: [] }),
  ).toBeNull()
})

it('says in words whether the agent needs the person', () => {
  expect(liveState('needs-input')).toBe('needs-you')
  expect(liveState('running')).toBe('working')
  expect(liveState(undefined)).toBe('idle')
})

it('keeps a dragged view where it was dropped, inside the window, as the window resizes', () => {
  const bounds = { width: 1000, height: 800, margin: 16, top: 56 }
  const size = { width: 320, height: 300 }
  // Untouched, it sits in the bottom-right corner.
  expect(livePlacement(undefined, bounds, size)).toEqual({ left: 664, top: 484 })
  const dropped = livePosition(340, 270, bounds, size)
  expect(livePlacement(dropped, bounds, size)).toEqual({ left: 340, top: 270 })
  // Dragged past an edge, it stops at the edge.
  expect(livePosition(-200, 5000, bounds, size)).toEqual({ x: 0, y: 1 })
  // A wider window keeps it at the same share of the free space.
  expect(livePlacement(dropped, { ...bounds, width: 1648 }, size).left).toBe(664)
})
