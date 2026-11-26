import { describe, expect, it } from 'vitest'
import { dragScroll, MIN_THUMB_PX, thumbGeometry } from '../src/lib/scrollThumb'

describe('thumbGeometry', () => {
  it('sizes the thumb by the visible share and places it by progress', () => {
    const axis = { scrollSize: 1000, clientSize: 200, trackSize: 200 }
    expect(thumbGeometry({ ...axis, scroll: 0 })).toEqual({ size: 40, offset: 0 })
    expect(thumbGeometry({ ...axis, scroll: 400 })).toEqual({ size: 40, offset: 80 })
  })

  it('reaches the end of the track exactly at the end of the content, and never leaves it', () => {
    const axis = { scrollSize: 1000, clientSize: 200, trackSize: 196 }
    const end = thumbGeometry({ ...axis, scroll: 800 })
    expect(end && end.offset + end.size).toBe(196)
    expect(thumbGeometry({ ...axis, scroll: 900 })).toEqual(end)
    expect(thumbGeometry({ ...axis, scroll: -50 })?.offset).toBe(0)
  })

  it('keeps a grabbable thumb for very long content', () => {
    const thumb = thumbGeometry({ scroll: 50_000, scrollSize: 100_200, clientSize: 200, trackSize: 196 })
    expect(thumb?.size).toBe(MIN_THUMB_PX)
    expect(thumb?.offset).toBeCloseTo((196 - MIN_THUMB_PX) / 2)
  })

  it('never draws a thumb longer than a track shorter than the minimum', () => {
    expect(thumbGeometry({ scroll: 0, scrollSize: 400, clientSize: 20, trackSize: 16 })).toEqual({
      size: 16,
      offset: 0,
    })
  })

  it('draws nothing when the content fits or the container has no size', () => {
    expect(thumbGeometry({ scroll: 0, scrollSize: 200, clientSize: 200, trackSize: 196 })).toBeNull()
    expect(thumbGeometry({ scroll: 0, scrollSize: 200, clientSize: 0, trackSize: -4 })).toBeNull()
  })
})

describe('dragScroll', () => {
  const axis = { scroll: 0, scrollSize: 1000, clientSize: 200, trackSize: 200 }

  it('maps the thumb travel onto the scroll range', () => {
    expect(dragScroll(axis, 80)).toBe(400)
    expect(dragScroll({ ...axis, scroll: 400 }, -40)).toBe(200)
  })

  it('lands where the thumb was dragged to', () => {
    const scroll = dragScroll(axis, 57)
    expect(thumbGeometry({ ...axis, scroll })?.offset).toBeCloseTo(57)
  })

  it('stops at both ends', () => {
    expect(dragScroll(axis, 5000)).toBe(800)
    expect(dragScroll({ ...axis, scroll: 300 }, -5000)).toBe(0)
  })

  it('leaves the offset alone when the thumb has no room to travel', () => {
    expect(dragScroll({ scroll: 30, scrollSize: 400, clientSize: 20, trackSize: 16 }, 10)).toBe(30)
    expect(dragScroll({ scroll: 0, scrollSize: 200, clientSize: 200, trackSize: 196 }, 10)).toBe(0)
  })
})
