import { expect, it } from 'vitest'
import { liveState, liveSurface, nextCorner } from '../src/liveView'

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

it('says in words whether the agent needs the person, and moves round the corners', () => {
  expect(liveState('needs-input')).toBe('needs-you')
  expect(liveState('running')).toBe('working')
  expect(liveState(undefined)).toBe('idle')
  expect(nextCorner('top-right')).toBe('bottom-right')
})
