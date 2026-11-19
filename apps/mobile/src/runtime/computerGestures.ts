type Size = { width: number; height: number }
type Point = { x: number; y: number }
export type ScreenRect = { left: number; top: number; width: number; height: number }

/** Where the remote screen is drawn inside the viewer: fitted, then zoomed around the centre and moved by `pan`. */
export function screenRect(area: Size, surface: Size, zoom: number, pan: Point): ScreenRect {
  if (!(area.width > 0 && area.height > 0 && surface.width > 0 && surface.height > 0))
    return { left: 0, top: 0, width: 0, height: 0 }
  const fit = Math.min(area.width / surface.width, area.height / surface.height) * zoom
  const width = surface.width * fit
  const height = surface.height * fit
  return { left: (area.width - width) / 2 + pan.x, top: (area.height - height) / 2 + pan.y, width, height }
}

/** Keeps a zoomed screen covering the viewer: it can move only as far as its zoomed edges reach. */
export function clampPan(area: Size, surface: Size, zoom: number, pan: Point): Point {
  const shown = screenRect(area, surface, zoom, { x: 0, y: 0 })
  const limit = (overflow: number, value: number) => {
    const reach = Math.max(0, overflow / 2)
    return Math.max(-reach, Math.min(reach, value))
  }
  return { x: limit(shown.width - area.width, pan.x), y: limit(shown.height - area.height, pan.y) }
}

/** The remote screen pixel under a touch in the viewer, or `null` for a touch on the bars around it. */
export function screenPoint(touch: Point, rect: ScreenRect, surface: Size): Point | null {
  if (!(rect.width > 0 && rect.height > 0)) return null
  const x = (touch.x - rect.left) / rect.width
  const y = (touch.y - rect.top) / rect.height
  if (x < 0 || y < 0 || x > 1 || y > 1) return null
  return {
    x: Math.min(surface.width - 1, Math.max(0, Math.round(x * surface.width))),
    y: Math.min(surface.height - 1, Math.max(0, Math.round(y * surface.height))),
  }
}

/** Two fingers: the new zoom from how far apart they are now, kept between actual fit and four times. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (!(startDistance > 0)) return startZoom
  return Math.max(1, Math.min(4, startZoom * (distance / startDistance)))
}
