import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ComputerNotRun,
  type ComputerAction,
  ComputerBackend,
  ComputerCapture,
  ComputerRuntimeStatus,
  ComputerTarget,
} from '@ramu/shared/computerBridge'

type Run = (file: string, args: string[]) => Promise<string>

const run: Run = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 15_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    ),
  )

/** Whether the Mac's screen is locked. The flag is in the system registry, readable without any permission. */
export function parseScreenLocked(registry: string): boolean {
  return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(registry)
}

export const LOCKED_MESSAGE =
  'The computer is locked. Unlock it, or turn on “Keep working while the screen is locked” in Settings → Browser → Computer use.'

/** The main display. App- and window-scoped confinement needs a driver that can enforce it, so it is not claimed. */
export const MAIN_DISPLAY: ComputerTarget = { id: 'display:main', kind: 'display', name: 'Main display' }

// Quartz events through JavaScript for Automation: no compiled helper, and the permission belongs to the process that
// runs `osascript`, which is Ramu's own host process.
const KEYS: Record<string, number> = {
  Enter: 36,
  Return: 36,
  Tab: 48,
  Space: 49,
  Backspace: 51,
  Delete: 117,
  Escape: 53,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,
  ArrowLeft: 123,
  ArrowRight: 124,
  ArrowDown: 125,
  ArrowUp: 126,
}
const FLAGS = { Shift: 0x20000, Control: 0x40000, Alt: 0x80000, Meta: 0x100000 }
// ANSI key codes for letters and digits.
const CHARS: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  '1': 18,
  '2': 19,
  '3': 20,
  '4': 21,
  '6': 22,
  '5': 23,
  '9': 25,
  '7': 26,
  '8': 28,
  '0': 29,
  o: 31,
  u: 32,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  k: 40,
  n: 45,
  m: 46,
}

export function keyCode(key: string): number | null {
  return KEYS[key] ?? (key.length === 1 ? (CHARS[key.toLowerCase()] ?? null) : null)
}

/** The JavaScript for Automation program for one action. Values are numbers or JSON strings, never interpolated text. */
export function actionScript(action: ComputerAction, scale: number): string {
  const head = "ObjC.import('ApplicationServices');"
  const post = (event: string) => `$.CGEventPost($.kCGHIDEventTap, ${event});`
  const mouse = (type: string, x: number, y: number, button: number) =>
    `var e=$.CGEventCreateMouseEvent(null,$.${type},{x:${x / scale},y:${y / scale}},${button});${post('e')}`
  switch (action.kind) {
    case 'click': {
      const [down, up, button] =
        action.button === 'right'
          ? ['kCGEventRightMouseDown', 'kCGEventRightMouseUp', 1]
          : action.button === 'middle'
            ? ['kCGEventOtherMouseDown', 'kCGEventOtherMouseUp', 2]
            : ['kCGEventLeftMouseDown', 'kCGEventLeftMouseUp', 0]
      const count = action.clickCount ?? 1
      let body = mouse('kCGEventMouseMoved', action.x, action.y, 0)
      for (let i = 1; i <= count; i++)
        body += `${mouse(down as string, action.x, action.y, button as number)}$.CGEventSetIntegerValueField(e,$.kCGMouseEventClickState,${i});${post('e')}${mouse(up as string, action.x, action.y, button as number)}$.CGEventSetIntegerValueField(e,$.kCGMouseEventClickState,${i});${post('e')}`
      return head + body
    }
    case 'drag': {
      const steps = 8
      let body =
        mouse('kCGEventMouseMoved', action.fromX, action.fromY, 0) +
        mouse('kCGEventLeftMouseDown', action.fromX, action.fromY, 0)
      for (let i = 1; i <= steps; i++) {
        const x = action.fromX + ((action.toX - action.fromX) * i) / steps
        const y = action.fromY + ((action.toY - action.fromY) * i) / steps
        body += mouse('kCGEventLeftMouseDragged', x, y, 0)
      }
      return head + body + mouse('kCGEventLeftMouseUp', action.toX, action.toY, 0)
    }
    case 'scroll':
      return (
        head +
        mouse('kCGEventMouseMoved', action.x, action.y, 0) +
        `var s=$.CGEventCreateScrollWheelEvent(null,$.kCGScrollEventUnitPixel,2,${-Math.round(action.dy)},${-Math.round(action.dx)});${post('s')}`
      )
    case 'type':
      // One Unicode event per character keeps IME, accents and emoji intact.
      return (
        head +
        `var t=${JSON.stringify(action.text)};for(var i=0;i<t.length;i++){var c=t.charCodeAt(i);for(var d=1;d>=0;d--){var e=$.CGEventCreateKeyboardEvent(null,0,d);$.CGEventKeyboardSetUnicodeString(e,1,[c]);${post('e')}}}`
      )
    case 'key': {
      const code = keyCode(action.key)
      if (code === null) throw new Error(`Unsupported key: ${action.key}`)
      const flags = (action.modifiers ?? []).reduce((all, key) => all | FLAGS[key], 0)
      return (
        head +
        `for(var d=1;d>=0;d--){var e=$.CGEventCreateKeyboardEvent(null,${code},d);$.CGEventSetFlags(e,${flags});${post('e')}}`
      )
    }
  }
}

/** Pixel size from `sips -g pixelWidth -g pixelHeight` output. */
export function parseSipsSize(output: string): { width: number; height: number } {
  const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1])
  const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1])
  if (!(width > 0 && height > 0)) throw new Error('The screen capture was not an image.')
  return { width, height }
}

/** Frames are shrunk so a phone can poll them: the long edge is capped and the image is a mid-quality JPEG. */
export const MAX_FRAME_EDGE = 1600

/**
 * macOS local broker: `screencapture` for the display and Quartz events for input. Screen Recording and Accessibility
 * belong to the process that runs Ramu's server, and denial is reported with its recovery step rather than guessed.
 */
export class MacosComputerBackend implements ComputerBackend {
  private permission: ComputerRuntimeStatus | null = null
  constructor(
    private readonly exec: Run = run,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly name: () => string = hostname,
  ) {}

  private lock: { locked: boolean; at: number } = { locked: false, at: 0 }

  /** Cached for two seconds so a viewer polling every few milliseconds does not shell out every time. */
  async locked(): Promise<boolean> {
    if (this.platform !== 'darwin') return false
    if (Date.now() - this.lock.at < 2000) return this.lock.locked
    try {
      this.lock = {
        locked: parseScreenLocked(await this.exec('/usr/sbin/ioreg', ['-n', 'Root', '-d1', '-a'])),
        at: Date.now(),
      }
    } catch {
      this.lock = { locked: false, at: Date.now() }
    }
    return this.lock.locked
  }

  status(): ComputerRuntimeStatus {
    // The last known lock state; capture and input look again before they act.
    if (this.platform === 'darwin' && this.lock.locked)
      return { available: false, reason: 'locked', detail: LOCKED_MESSAGE }
    if (this.platform !== 'darwin')
      return { available: false, reason: 'unsupported', detail: 'Computer use currently supports macOS.' }
    if (this.permission) return this.permission
    return { available: true, computer: { id: 'local', name: this.name() } }
  }

  async capture(target: ComputerTarget): Promise<ComputerCapture> {
    if (this.platform !== 'darwin') throw new Error('Computer use currently supports macOS.')
    if (await this.locked()) throw new ComputerNotRun(LOCKED_MESSAGE)
    if (target.kind !== 'display') throw new Error('Only display capture is supported.')
    const dir = await mkdtemp(join(tmpdir(), 'ramu-screen-'))
    const raw = join(dir, 'screen.png')
    const small = join(dir, 'frame.jpg')
    try {
      await this.exec('/usr/sbin/screencapture', ['-x', '-t', 'png', '-C', raw]).catch((error) => {
        this.permission = {
          available: false,
          reason: 'permission-denied',
          detail: 'Allow Screen Recording for Ramu in System Settings → Privacy & Security.',
        }
        throw error
      })
      const full = parseSipsSize(await this.exec('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', raw]))
      await this.exec('/usr/bin/sips', [
        '-Z',
        String(MAX_FRAME_EDGE),
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '60',
        raw,
        '--out',
        small,
      ])
      const { width, height } = parseSipsSize(
        await this.exec('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', small]),
      )
      const bytes = await readFile(small)
      this.permission = null
      // Actions are in frame pixels; `scale` maps them back to screen points.
      const points = await this.points()
      const scale = points > 0 ? width / points : full.width / width
      this.lastScale = scale
      return { mimeType: 'image/jpeg', data: bytes.toString('base64'), width, height, scale }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  private async points(): Promise<number> {
    try {
      const out = await this.exec('/usr/bin/osascript', [
        '-l',
        'JavaScript',
        '-e',
        "ObjC.import('AppKit');$.NSScreen.mainScreen.frame.size.width",
      ])
      return Number(out.trim())
    } catch {
      return 0
    }
  }

  async perform(target: ComputerTarget, action: ComputerAction): Promise<void> {
    if (this.platform !== 'darwin') throw new Error('Computer use currently supports macOS.')
    if (await this.locked()) throw new ComputerNotRun(LOCKED_MESSAGE)
    void target
    const scale = this.lastScale
    try {
      await this.exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', actionScript(action, scale)])
    } catch (error) {
      this.permission = {
        available: false,
        reason: 'permission-denied',
        detail: 'Allow Accessibility for Ramu in System Settings → Privacy & Security.',
      }
      throw error
    }
    this.permission = null
  }

  private lastScale = 1

  /** A streaming capture knows the frame size, so input maps frame pixels to screen points with its scale. */
  useScale(scale: number): void {
    if (scale > 0) this.lastScale = scale
  }

  releaseInput(): void {
    // Actions are discrete press/release pairs, so nothing is held between calls.
  }
}
