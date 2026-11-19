import { expect, it } from 'vitest'
import { openOverlays, paneCovered } from '../src/views/browserOverlay'

const pane = { left: 400, top: 100, right: 1000, bottom: 800 }
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

it('hides the page for overlays that reach into the pane', () => {
  expect(paneCovered(pane, [])).toBe(false)
  // A menu opened from the sidebar that stays left of the pane leaves the page alone.
  expect(paneCovered(pane, [{ modal: false, box: box(0, 100, 380, 400) }])).toBe(false)
  expect(paneCovered(pane, [{ modal: false, box: box(300, 100, 420, 400) }])).toBe(true)
  // Touching edges is not an overlap.
  expect(paneCovered(pane, [{ modal: false, box: box(0, 0, 400, 100) }])).toBe(false)
})

it('hides the page for any modal dialog and ignores collapsed overlays', () => {
  expect(paneCovered(pane, [{ modal: true, box: box(0, 0, 200, 200) }])).toBe(true)
  // Unmounting or closed popups measure as empty boxes.
  expect(paneCovered(pane, [{ modal: true, box: box(0, 0, 0, 0) }])).toBe(false)
  expect(paneCovered(pane, [{ modal: false, box: box(500, 200, 500, 200) }])).toBe(false)
})

it('ignores popups that are closing or hidden', () => {
  const popup = (attributes: string[], hidden = false) =>
    ({
      hasAttribute: (name: string) => attributes.includes(name),
      closest: () => (hidden ? {} : null),
      getAttribute: () => null,
      getBoundingClientRect: () => box(500, 200, 600, 300),
    }) as unknown as Element
  const doc = {
    querySelectorAll: () => [popup([]), popup(['data-ending-style']), popup(['data-closed']), popup([], true)],
  } as unknown as Document
  const root = { contains: () => false } as unknown as Element
  expect(openOverlays(doc, root)).toHaveLength(1)
})
