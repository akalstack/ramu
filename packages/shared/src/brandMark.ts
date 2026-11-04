/**
 * The Ramu mark (the r stem and its dot) and its motion, shared by the desktop and the phone so both draw and move it
 * the same way. Coordinates are in the 1024-unit icon artwork; the mark's own box is the 540-unit square at 240.
 */
export const MARK = {
  origin: 240,
  size: 540,
  stem: 'M356 694V518C356 402 434 334 548 334',
  /** The stem pivots on its foot, the dot on its center. */
  stemPivot: [356, 694] as const,
  dot: { cx: 664, cy: 622, r: 72 },
  dotColor: '#7d6cff',
} as const

export const MARK_VIEW_BOX = `${MARK.origin} ${MARK.origin} ${MARK.size} ${MARK.size}`

/**
 * The launch image is the 1024-unit artwork drawn this many points wide (the phone's splash `imageWidth`), so the
 * startup mark is this size and sits where the launch image left it.
 */
export const LAUNCH_IMAGE_WIDTH = 200
export const STARTUP_MARK_SIZE = (LAUNCH_IMAGE_WIDTH * MARK.size) / 1024

/** How the mark wakes: the stem rocks back and the dot hops up and over, then both settle. Startup and tap share it. */
export const MARK_WAKE = {
  duration: 650,
  stem: [
    { at: 0, rotate: 0 },
    { at: 0.28, rotate: -9 },
    { at: 0.62, rotate: 4 },
    { at: 0.82, rotate: -2 },
    { at: 1, rotate: 0 },
  ],
  /** Offsets in artwork units; scale squashes and stretches the dot as it lands and leaves. */
  dot: [
    { at: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    { at: 0.18, x: 0, y: 8, scaleX: 1.18, scaleY: 0.82 },
    { at: 0.46, x: 30, y: -110, scaleX: 0.9, scaleY: 1.1 },
    { at: 0.76, x: 0, y: 6, scaleX: 1.12, scaleY: 0.88 },
    { at: 0.9, x: 0, y: -10, scaleX: 0.97, scaleY: 1.03 },
    { at: 1, x: 0, y: 0, scaleX: 1, scaleY: 1 },
  ],
} as const

/** The startup screen fades into the app over this long once the app is ready and the mark has woken. */
export const STARTUP_FADE = 200
