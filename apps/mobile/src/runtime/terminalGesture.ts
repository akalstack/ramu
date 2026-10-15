export type Direction = 'left' | 'right' | 'up' | 'down'
export interface TerminalGestureState {
  active: boolean
  direction: Direction | null
  speed: number
  progress: number
  steps: number
  x: number
  y: number
}
export const HOLD_MS = 650
const DEAD_ZONE = 12
const MAX_DRAG = 112

/** Hold-and-drag cursor control. Distance sets repetition rate; a full gauge sends one key. */
export class TerminalGesture {
  private started: number | null = null
  private active = false
  private x = 0
  private y = 0
  private direction: Direction | null = null
  private speed = 0
  private progress = 0
  private lastTick = 0

  begin(x: number, y: number, now: number) {
    this.cancel()
    this.started = now
    this.lastTick = now
    this.x = x
    this.y = y
  }
  cancel() {
    this.started = null
    this.active = false
    this.direction = null
    this.speed = 0
    this.progress = 0
  }
  move(x: number, y: number, now: number) {
    if (this.started === null) return
    const dx = x - this.x,
      dy = y - this.y
    if (!this.active) {
      if (now - this.started < HOLD_MS) {
        // Ordinary swipes remain normal terminal scrolling/selection.
        if (Math.hypot(dx, dy) > 8) this.cancel()
        return
      }
      this.active = true
      this.lastTick = now
    }
    const distance = Math.max(Math.abs(dx), Math.abs(dy))
    let direction: Direction | null = null
    if (distance > DEAD_ZONE) {
      // Small diagonal drift must not switch between history and cursor motion.
      const horizontal = this.direction === 'left' || this.direction === 'right'
      const vertical = this.direction === 'up' || this.direction === 'down'
      const useX = horizontal
        ? Math.abs(dy) < Math.abs(dx) * 1.25
        : vertical
          ? Math.abs(dx) > Math.abs(dy) * 1.25
          : Math.abs(dx) >= Math.abs(dy)
      direction = useX ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
    }
    if (direction !== this.direction) {
      this.progress = 0
      this.lastTick = now
    }
    this.direction = direction
    this.speed = direction ? Math.min(1, (distance - DEAD_ZONE) / (MAX_DRAG - DEAD_ZONE)) : 0
  }
  tick(now: number): TerminalGestureState {
    if (this.started !== null && !this.active && now - this.started >= HOLD_MS) {
      this.active = true
      this.lastTick = now
    }
    let steps = 0
    if (this.active && this.direction) {
      // Never catch up in a burst after a dropped frame or background pause.
      const elapsed = Math.max(0, Math.min(64, now - this.lastTick))
      const interval = 650 * Math.pow(70 / 650, this.speed)
      this.progress += elapsed / interval
      if (this.progress >= 1) {
        steps = 1
        this.progress %= 1
      }
    }
    this.lastTick = now
    return {
      active: this.active,
      direction: this.direction,
      speed: this.speed,
      progress: steps ? 1 : this.progress,
      steps,
      x: this.x,
      y: this.y,
    }
  }
}

export function arrowSequence(direction: Direction, applicationCursorKeys = false): string {
  const suffix = { up: 'A', down: 'B', right: 'C', left: 'D' }[direction]
  return '\x1b' + (applicationCursorKeys ? 'O' : '[') + suffix
}

/** Stay beside the hold origin, away from the finger, without chasing each move. */
export function gestureOverlayPosition(x: number, y: number, width: number, height: number, size = 112) {
  const margin = 12,
    gap = 24
  const left = x + gap + size <= width - margin ? x + gap : x - gap - size
  const top = y - gap - size >= margin ? y - gap - size : y + gap
  const clamp = (value: number, available: number) =>
    Math.max(0, Math.min(Math.max(margin, value), Math.max(0, available - size - margin)))
  return { left: clamp(left, width), top: clamp(top, height) }
}
