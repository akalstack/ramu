import type { BrowserFieldFocus } from '@ramu/shared/browserBridge'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import INPUT_SOURCE from '../../native/ramu-input.swift?raw'
import { NativeInput } from './nativeInput'
import { ensureHelper } from './nativeHelper'
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

export type ScreenState = 'open' | 'locked' | 'away'

/**
 * The screen as this user's session sees it. `away` is the login window (or another user) on the physical screen with
 * this session running behind it: Fast User Switching, or the lock screen's account list. Registry session entries are
 * flat dictionaries, so the one holding this user's id is the text between its surrounding dict tags.
 */
export function parseScreenState(registry: string, uid: number): ScreenState {
  const id = new RegExp(`<key>kCGSSessionUserIDKey</key>\\s*<integer>${uid}</integer>`).exec(registry)
  if (id) {
    const start = registry.lastIndexOf('<dict>', id.index)
    const end = registry.indexOf('</dict>', id.index)
    const session = registry.slice(start, end === -1 ? undefined : end)
    if (/<key>kCGSSessionOnConsoleKey<\/key>\s*<false\/>/.test(session)) return 'away'
  }
  return parseScreenLocked(registry) ? 'locked' : 'open'
}

// macOS keeps screen capture and posted input away from the lock screen, so the whole display waits for an unlock.
// Open Computer Use's Locked Use reaches one app behind it, which is what an app grant uses.
export const LOCKED_MESSAGE =
  'This Mac is locked, so its main display cannot be seen or controlled. Unlock it, or allow one app instead. With “Keep working while the screen is locked” on, work in that app continues behind the lock screen.'

// The login window belongs to macOS itself; only system software such as Screen Sharing can type into it.
export const AWAY_MESSAGE =
  'This Mac is showing its login window, so its main display cannot be seen or controlled from Ramu. macOS lets only system software, such as Screen Sharing, type there. Sign in at the Mac or with Screen Sharing, then open the display again.'

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

/**
 * One input as a line for the native input helper (see ramu-input.swift), in screen points. Null for a key this Mac has
 * no code for.
 */
export function inputCommand(action: ComputerAction, scale: number): string | null {
  const p = (value: number) => Math.round((value / scale) * 100) / 100
  switch (action.kind) {
    case 'move':
      return `move ${p(action.x)} ${p(action.y)}`
    case 'click': {
      const button = action.button === 'right' ? 1 : action.button === 'middle' ? 2 : 0
      return `click ${p(action.x)} ${p(action.y)} ${button} ${action.clickCount ?? 1}`
    }
    case 'scroll':
      return `scroll ${p(action.x)} ${p(action.y)} ${Math.round(action.dx)} ${Math.round(action.dy)}`
    case 'drag':
      return `drag ${p(action.fromX)} ${p(action.fromY)} ${p(action.toX)} ${p(action.toY)}`
    case 'key': {
      const code = keyCode(action.key)
      if (code === null) return null
      return `key ${code} ${(action.modifiers ?? []).reduce((all, key) => all | FLAGS[key], 0)}`
    }
    case 'type':
      return `type ${Buffer.from(action.text, 'utf8').toString('base64')}`
  }
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
    case 'move':
      return head + mouse('kCGEventMouseMoved', action.x, action.y, 0)
    case 'scroll':
      return (
        head +
        mouse('kCGEventMouseMoved', action.x, action.y, 0) +
        `var s=$.CGEventCreateScrollWheelEvent(null,$.kCGScrollEventUnitPixel,2,${-Math.round(action.dy)},${-Math.round(action.dx)});${post('s')}`
      )
    case 'type':
      // One Unicode event per character keeps IME, accents and emoji intact. The character must be passed as a typed
      // UniChar reference: the bridge turns a plain array or string into nothing, and key code 0 then types "a".
      return (
        head +
        `var t=${JSON.stringify(action.text)};for(var i=0;i<t.length;i++){var u=Ref('unsigned short');u[0]=t.charCodeAt(i);for(var d=1;d>=0;d--){var e=$.CGEventCreateKeyboardEvent(null,0,d);$.CGEventKeyboardSetUnicodeString(e,1,u);${post('e')}}}`
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

/** Milliseconds since the last real or synthetic HID event, from `ioreg -c IOHIDSystem` (nanoseconds). Null when unreadable. */
/** Reads the role of the focused accessibility element; prints `role|subrole`, or nothing when none answers. */
export const FOCUS_SCRIPT =
  "ObjC.import('ApplicationServices');var s=$.AXUIElementCreateSystemWide(),f=Ref(),r=Ref(),u=Ref(),o='';" +
  "if($.AXUIElementCopyAttributeValue(s,$('AXFocusedUIElement'),f)===0){$.AXUIElementCopyAttributeValue(f[0],$('AXRole'),r);" +
  "$.AXUIElementCopyAttributeValue(f[0],$('AXSubrole'),u);o=ObjC.unwrap(ObjC.castRefToObject(r[0]))+'|'+" +
  "(u[0]?ObjC.unwrap(ObjC.castRefToObject(u[0])):'')}o"

/** What kind of keyboard the focused element wants, from its accessibility role. */
export function focusFromRole(output: string): BrowserFieldFocus {
  const [role = '', subrole = ''] = output.trim().split('|')
  if (subrole === 'AXSecureTextField') return { editable: true, kind: 'password' }
  if (subrole === 'AXSearchField') return { editable: true, kind: 'search' }
  if (role === 'AXTextArea') return { editable: true, kind: 'multiline' }
  if (role === 'AXTextField' || role === 'AXComboBox') return { editable: true, kind: 'text' }
  return { editable: false }
}

export function parseHidIdleMs(registry: string): number | null {
  const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(registry)
  return match ? Number(match[1]) / 1_000_000 : null
}

/** The person counts as using the computer when a HID event arrived within this long. */
export const LOCAL_INPUT_WINDOW_MS = 2000
/** Events this soon after Ramu's own injection finished are taken to be Ramu's, not the person's. */
export const INJECTION_SLACK_MS = 400

/** Releases anything an interrupted action left held: the mouse buttons at the pointer and the modifier keys. */
export function releaseScript(): string {
  const post = (event: string) => `$.CGEventPost($.kCGHIDEventTap, ${event});`
  let body = "ObjC.import('ApplicationServices');var p=$.CGEventGetLocation($.CGEventCreate(null));"
  for (const [type, button] of [
    ['kCGEventLeftMouseUp', 0],
    ['kCGEventRightMouseUp', 1],
    ['kCGEventOtherMouseUp', 2],
  ] as const)
    body += `var m=$.CGEventCreateMouseEvent(null,$.${type},p,${button});${post('m')}`
  for (const code of [56, 59, 58, 55])
    body += `var k=$.CGEventCreateKeyboardEvent(null,${code},false);$.CGEventSetFlags(k,0);${post('k')}`
  return body
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
const HID_IDLE_REUSE_MS = 400

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
    /** One process that posts input as it arrives; null falls back to a script per action. */
    inputHelper: () => Promise<ChildProcess | null> = async () =>
      spawn(await ensureHelper(INPUT_SOURCE, 'ramu-input'), [], { stdio: ['pipe', 'pipe', 'ignore'] }),
  ) {
    this.input = new NativeInput(inputHelper)
  }

  private readonly input: NativeInput

  /** Builds and starts the input helper ahead of the first action. */
  warm(): void {
    if (this.platform === 'darwin') void this.input.available()
  }

  private lock: { state: ScreenState; at: number } = { state: 'open', at: 0 }

  /** Cached for two seconds so a viewer polling every few milliseconds does not shell out every time. */
  private async screen(): Promise<ScreenState> {
    if (this.platform !== 'darwin') return 'open'
    if (Date.now() - this.lock.at < 2000) return this.lock.state
    try {
      const registry = await this.exec('/usr/sbin/ioreg', ['-n', 'Root', '-d1', '-a'])
      this.lock = { state: parseScreenState(registry, process.getuid?.() ?? -1), at: Date.now() }
    } catch {
      this.lock = { state: 'open', at: Date.now() }
    }
    return this.lock.state
  }

  async locked(): Promise<boolean> {
    return (await this.screen()) !== 'open'
  }

  async awayFromScreen(): Promise<boolean> {
    return (await this.screen()) === 'away'
  }

  private refusal(state: ScreenState): ComputerNotRun {
    return new ComputerNotRun(state === 'away' ? AWAY_MESSAGE : LOCKED_MESSAGE)
  }

  status(): ComputerRuntimeStatus {
    // The last known lock state; capture and input look again before they act.
    if (this.platform === 'darwin' && this.lock.state !== 'open')
      return { available: false, reason: 'locked', detail: this.lock.state === 'away' ? AWAY_MESSAGE : LOCKED_MESSAGE }
    if (this.platform !== 'darwin')
      return { available: false, reason: 'unsupported', detail: 'Computer use currently supports macOS.' }
    if (this.permission) return this.permission
    return { available: true, computer: { id: 'local', name: this.name() } }
  }

  async capture(target: ComputerTarget): Promise<ComputerCapture> {
    if (this.platform !== 'darwin') throw new Error('Computer use currently supports macOS.')
    const state = await this.screen()
    if (state !== 'open') throw this.refusal(state)
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

  private injecting = 0
  private lastInjectionEnd = 0
  private releaseAfter = false

  /**
   * Whether the person is using the real mouse or keyboard. The HID idle time also resets for events Ramu posts, so
   * anything within a short slack of Ramu's own last injection is ignored, and nothing is judged while one runs.
   */
  async focusedField(): Promise<BrowserFieldFocus> {
    if (this.platform !== 'darwin') return { editable: false }
    try {
      return focusFromRole(await this.exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FOCUS_SCRIPT]))
    } catch {
      return { editable: false }
    }
  }

  // Reading the HID idle time starts a process; a burst of remote input asks within a few hundred milliseconds.
  private idle: { ms: number | null; at: number } = { ms: null, at: 0 }

  async localInputActive(): Promise<boolean> {
    if (this.platform !== 'darwin' || this.injecting > 0) return false
    try {
      const now = Date.now()
      if (now - this.idle.at >= HID_IDLE_REUSE_MS)
        this.idle = {
          ms: parseHidIdleMs(await this.exec('/usr/sbin/ioreg', ['-r', '-d', '1', '-c', 'IOHIDSystem'])),
          at: now,
        }
      // Idle time grows while the reading is reused, so age it rather than read it again.
      const idle = this.idle.ms === null ? null : this.idle.ms + (Date.now() - this.idle.at)
      if (idle === null || idle >= LOCAL_INPUT_WINDOW_MS) return false
      return Date.now() - idle > this.lastInjectionEnd + INJECTION_SLACK_MS
    } catch {
      return false
    }
  }

  async perform(target: ComputerTarget, action: ComputerAction, options?: { byPerson?: boolean }): Promise<void> {
    if (this.platform !== 'darwin') throw new Error('Computer use currently supports macOS.')
    // The person in control may click and type at the lock screen, to unlock it as they would at the Mac. An agent may
    // not, and nobody reaches the login window: input from this session would go nowhere.
    const state = await this.screen()
    if (state === 'away' || (state === 'locked' && !options?.byPerson)) throw this.refusal(state)
    void target
    const scale = this.lastScale
    const command = inputCommand(action, scale)
    if (command === null && action.kind === 'key') throw new Error(`Unsupported key: ${action.key}`)
    this.injecting++
    try {
      // The helper answers each action as soon as it is posted; a script per action is the fallback.
      if (command && (await this.input.available())) await this.input.send(command, action.kind !== 'move')
      else await this.exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', actionScript(action, scale)])
    } catch (error) {
      this.permission = {
        available: false,
        reason: 'permission-denied',
        detail: 'Allow Accessibility for Ramu in System Settings → Privacy & Security.',
      }
      throw error
    } finally {
      this.injecting--
      this.lastInjectionEnd = Date.now()
      if (this.releaseAfter && this.injecting === 0) this.releaseHeld()
    }
    this.permission = null
  }

  private releaseHeld() {
    this.releaseAfter = false
    void this.exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', releaseScript()])
      .catch(() => {})
      .finally(() => {
        this.lastInjectionEnd = Date.now()
      })
  }

  private lastScale = 1

  /** A streaming capture knows the frame size, so input maps frame pixels to screen points with its scale. */
  useScale(scale: number): void {
    if (scale > 0) this.lastScale = scale
  }

  releaseInput(): void {
    // Actions are discrete press/release pairs, so nothing is held between calls. One cut short mid-drag or mid-key
    // is released as soon as it settles.
    if (this.platform !== 'darwin') return
    if (this.injecting > 0) this.releaseAfter = true
  }
}
