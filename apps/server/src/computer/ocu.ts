import { execFile, execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type {
  ComputerAction,
  ComputerBackend,
  ComputerCapture,
  ComputerModifier,
  ComputerRuntimeStatus,
  ComputerTarget,
} from '@ramu/shared/computerBridge'
import { MAX_COMPUTER_TREE_TEXT } from '@ramu/shared/computerBridge'
import { ensureNodeOnPath, findExecutable } from '../providers/providerBinaries'

/** The part of an MCP client this backend uses, so a fake can stand in for the native process in tests. */
export interface OcuClient {
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
  /** Set by the backend: the helper went away, so the next call starts a new one instead of failing on this one. */
  onclose?: () => void
}

/** Tools that only read, so one that failed because the helper had just gone away can run again on a new one. */
const READ_ONLY_TOOLS = new Set(['list_apps', 'get_app_state'])
/**
 * Locked Use belongs to one connection at a time. Another app running its own Open Computer Use (an agent tool's MCP
 * server, say) can hold it, and Open Computer Use's own words do not say so.
 */
export function explained(message: string): string {
  if (/locked use belongs to another connection/i.test(message))
    return 'Another app on this Mac is using Open Computer Use behind the lock screen (for example another agent tool). Quit it or remove its Open Computer Use server, then unlock the Mac once.'
  // Its own words for the login window (Fast User Switching, or the lock screen's account list) on the screen.
  if (/no completed gui session|cannot operate a login, switched-user/i.test(message))
    return 'This Mac is showing its login window, so its apps cannot be used from Ramu. macOS lets only system software, such as Screen Sharing, sign in there. Sign in at the Mac or with Screen Sharing, then try again.'
  if (/locked use (is unavailable|stopped)|no active locked use lease/i.test(message))
    return 'Unlock this Mac once. Working behind the lock screen can only begin after a normal unlock, and it ended when Open Computer Use restarted. It continues through later locks.'
  return message
}

/** Enough of the tree for a viewer frame to find the page's scroll area; the agent's observations keep the full tree. */
const VIEWER_TREE_NODES = 120
const closedConnection = (error: unknown) => /connection closed|not connected/i.test(String(error))

interface ToolResult {
  isError?: boolean
  content?: { type: string; text?: string; data?: string; mimeType?: string }[]
}

const XDOTOOL_KEYS: Record<string, string> = {
  Enter: 'Return',
  Backspace: 'BackSpace',
  Escape: 'Escape',
  Tab: 'Tab',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page_Up',
  PageDown: 'Page_Down',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'space',
}
const XDOTOOL_MODIFIERS: Record<ComputerModifier, string> = {
  Alt: 'alt',
  Control: 'ctrl',
  Meta: 'super',
  Shift: 'shift',
}

/** Ramu's key and modifiers in the xdotool syntax `press_key` takes. */
export function ocuKey(key: string, modifiers: ComputerModifier[] = []): string {
  return [...modifiers.map((modifier) => XDOTOOL_MODIFIERS[modifier]), XDOTOOL_KEYS[key] ?? key].join('+')
}

// Key names `press_key` accepts for punctuation: keypad keys and shifted digits.
const KEYSYMS: Record<string, string> = {
  '*': 'KP_Multiply',
  '+': 'KP_Add',
  '-': 'KP_Subtract',
  '/': 'KP_Divide',
  '=': 'KP_Equal',
  '.': 'KP_Decimal',
  '(': 'shift+9',
  ')': 'shift+0',
  '%': 'shift+5',
  '!': 'shift+1',
  '@': 'shift+2',
  '#': 'shift+3',
  $: 'shift+4',
  '^': 'shift+6',
  '&': 'shift+7',
  ' ': 'space',
  '\n': 'Return',
  '\t': 'Tab',
}

/** Keys that type `text` one character at a time, for apps with no editable text field (a calculator, a game). */
export function typingKeys(text: string): string[] | null {
  const keys: string[] = []
  for (const char of text) {
    const key =
      KEYSYMS[char] ?? (/^[a-z0-9]$/.test(char) ? char : /^[A-Z]$/.test(char) ? `shift+${char.toLowerCase()}` : null)
    if (!key) return null
    keys.push(key)
  }
  return keys
}

/** Element numbers of scroll areas in an app-state tree: lines like `4 scroll area ID: StandardResultView, …`. */
export function scrollAreas(tree: string): string[] {
  return tree
    .split('\n')
    .map((line) => /^\s*(\d+) scroll area\b/.exec(line)?.[1])
    .filter((index): index is string => !!index)
}

export function parseApps(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /^(.+?) — [\w.-]+(?: \[|$)/.exec(line.trim())?.[1])
    .filter((name): name is string => !!name)
}

export function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG')
    throw new Error('The app screenshot was not an image.')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** The release Ramu installs and has been checked against. */
export const OCU_VERSION = '1.1.2'

export const ocuToolsDir = () => process.env.RAMU_TOOLS_DIR ?? join(homedir(), '.ramu/tools')

type Exec = (file: string, args: string[]) => Promise<string>
const execute: Exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 300_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    ),
  )

/** Installs the pinned release under Ramu's own tools folder, never globally and never as an unpinned latest. */
export async function installOcu(exec: Exec = execute, npm: string | null = findExecutable('npm')): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('App-scoped computer use currently supports macOS.')
  if (!npm) throw new Error('Install Node.js (npm) first, then try again.')
  ensureNodeOnPath()
  const dir = join(ocuToolsDir(), `ocu-${OCU_VERSION}`)
  await exec(npm, ['install', '--prefix', dir, '--no-audit', '--no-fund', `open-computer-use@${OCU_VERSION}`])
  const installed = join(dir, 'node_modules/.bin/ocu')
  const version = (await exec(installed, ['--version'])).trim()
  if (version !== OCU_VERSION) throw new Error(`Installed Open Computer Use ${version}, expected ${OCU_VERSION}.`)
  versions.clear()
  return version
}

const versions = new Map<string, string | null>()

/** The version a copy reports, remembered per path: an old copy has a different tool set and must not be used. */
function versionOf(path: string): string | null {
  if (!versions.has(path)) {
    try {
      versions.set(path, execFileSync(path, ['--version'], { timeout: 8000, encoding: 'utf8' }).trim())
    } catch {
      versions.set(path, null)
    }
  }
  return versions.get(path) ?? null
}

/** Ramu's own pinned install first; any other copy only when it is exactly the release Ramu was checked against. */
export function ocuExecutable(): string | null {
  const configured = process.env.RAMU_OCU_PATH
  const pinned = findExecutable(join(ocuToolsDir(), `ocu-${OCU_VERSION}`, 'node_modules/.bin/ocu'))
  if (configured) {
    const path = findExecutable(configured)
    return path && versionOf(path) === OCU_VERSION ? path : null
  }
  if (pinned && versionOf(pinned) === OCU_VERSION) return pinned
  const others = [
    findExecutable('ocu'),
    findExecutable('open-computer-use'),
    findExecutable('/opt/homebrew/bin/ocu'),
    findExecutable('/usr/local/bin/ocu'),
  ]
  return others.find((path): path is string => !!path && versionOf(path) === OCU_VERSION) ?? null
}

/** Reports the actual managed installation, including an old release that cannot run with this Ramu. */
export function ocuUpdateStatus(): {
  installedVersion: string | null
  supportedVersion: string
  updateAvailable: boolean
  managed: boolean
} {
  let installedVersion: string | null = null
  for (const root of [join(ocuToolsDir(), `ocu-${OCU_VERSION}`), ocuToolsDir()]) {
    try {
      const value = JSON.parse(readFileSync(join(root, 'node_modules/open-computer-use/package.json'), 'utf8')).version
      if (typeof value === 'string') {
        installedVersion = value
        break
      }
    } catch {}
  }
  return {
    installedVersion,
    supportedVersion: OCU_VERSION,
    updateAvailable: !!installedVersion && installedVersion !== OCU_VERSION && !process.env.RAMU_OCU_PATH,
    managed: !process.env.RAMU_OCU_PATH,
  }
}

/** Read the runtime's own permissions without opening its onboarding UI. */
export async function ocuPermissions(
  executable: string | null = ocuExecutable(),
  read: (file: string, args: string[]) => Promise<string> = (file, args) =>
    new Promise((resolve, reject) => {
      execFile(file, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      )
    }),
): Promise<{ allGranted: boolean; accessibilityTrusted: boolean; screenCaptureGranted: boolean } | null> {
  if (!executable || process.platform !== 'darwin') return null
  try {
    const raw = JSON.parse(await read(executable, ['doctor', '--json']))
    if (
      typeof raw.accessibilityTrusted !== 'boolean' ||
      typeof raw.screenCaptureGranted !== 'boolean' ||
      typeof raw.allGranted !== 'boolean'
    )
      return null
    return {
      allGranted: raw.allGranted && raw.accessibilityTrusted && raw.screenCaptureGranted,
      accessibilityTrusted: raw.accessibilityTrusted,
      screenCaptureGranted: raw.screenCaptureGranted,
    }
  } catch {
    return null
  }
}

/** Starts OCU's own macOS doctor/onboarding UI. Never changes TCC grants itself. */
export async function setupOcu(
  executable: string | null = ocuExecutable(),
  start: (file: string, args: string[]) => Promise<void> = (file, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(file, args, { stdio: 'ignore', detached: true })
      child.once('error', () =>
        reject(new Error('Open Computer Use setup could not start. Try Set up permissions again.')),
      )
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    }),
): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('App-scoped computer use currently supports macOS.')
  if (!executable) throw new Error('Install Open Computer Use first.')
  await start(executable, ['doctor'])
}

/**
 * Open Computer Use (MIT): acts on one named app through the Accessibility tree and posts input to that app, so the
 * person's own cursor and focus stay theirs. Coordinates are pixels of the app screenshot that capture returns.
 */
export class OcuBackend implements ComputerBackend {
  private client: Promise<OcuClient> | null = null
  constructor(
    private readonly executable: () => string | null = ocuExecutable,
    private readonly connect: (executable: string, globalPointer: boolean) => Promise<OcuClient> = async (
      command,
      globalPointer,
    ) => {
      const client = new Client({ name: 'ramu-computer', version: '0.1.0' }, { capabilities: {} })
      await client.connect(
        new StdioClientTransport({
          command,
          args: ['mcp'],
          stderr: 'ignore',
          // Window moves and text selection need the real pointer. Open Computer Use only does that when told to.
          env: {
            ...(process.env as Record<string, string>),
            ...(globalPointer ? { OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS: '1' } : {}),
          },
        }),
        { timeout: 30_000 },
      )
      return client as unknown as OcuClient
    },
    /** Whether drags may use the person's real pointer (off by default). Read each time, so a change applies at once. */
    private readonly globalPointer: () => boolean = () => false,
  ) {}

  private connectedWithPointer = false

  status(): ComputerRuntimeStatus {
    if (process.platform !== 'darwin')
      return { available: false, reason: 'unsupported', detail: 'App-scoped computer use currently supports macOS.' }
    if (!this.executable())
      return {
        available: false,
        reason: 'not-installed',
        detail: 'Install Open Computer Use to let agents use one app in the background.',
      }
    return { available: true, computer: { id: 'local', name: 'This computer' } }
  }

  private async session(): Promise<OcuClient> {
    const path = this.executable()
    if (!path) throw new Error('Open Computer Use is not installed.')
    const pointer = this.globalPointer()
    if (this.client && pointer !== this.connectedWithPointer) {
      // The setting changed: the helper reads it only at start, so start a new one.
      const previous = await this.client.catch(() => null)
      this.client = null
      await previous?.close().catch(() => {})
    }
    this.connectedWithPointer = pointer
    if (!this.client) {
      const pending: Promise<OcuClient> = this.connect(path, pointer).then(
        (client) => {
          // Open Computer Use can exit between calls (a Locked Use session ending, a crash); forget it at once.
          const before = client.onclose
          client.onclose = () => {
            before?.()
            if (this.client === pending) this.client = null
          }
          return client
        },
        (error) => {
          if (this.client === pending) this.client = null
          throw error
        },
      )
      this.client = pending
    }
    return this.client
  }

  private async call(name: string, args: Record<string, unknown>, retry = true): Promise<ToolResult> {
    const client = await this.session()
    let result: ToolResult
    try {
      result = (await client.callTool({ name, arguments: args })) as ToolResult
    } catch (error) {
      // Only a helper that is really gone is replaced. Closing a live one for an ordinary refusal would end its
      // Locked Use session, and a new one cannot start until the Mac is unlocked normally.
      if (!closedConnection(error))
        throw error instanceof Error ? new Error(explained(error.message), { cause: error }) : error
      this.client = null
      await client.close().catch(() => {})
      // Input is never sent twice: it may have run. A read can simply be asked again of a fresh helper.
      if (retry && READ_ONLY_TOOLS.has(name)) return this.call(name, args, false)
      throw error instanceof Error ? new Error(explained(error.message), { cause: error }) : error
    }
    if (result.isError)
      throw new Error(explained(result.content?.find((part) => part.type === 'text')?.text ?? `${name} failed`))
    return result
  }

  async apps(): Promise<string[]> {
    const result = await this.call('list_apps', {})
    return parseApps(result.content?.find((part) => part.type === 'text')?.text ?? '')
  }

  private trees = new Map<string, string[]>()

  async capture(target: ComputerTarget, options?: { forViewer?: boolean }): Promise<ComputerCapture> {
    // A person watching needs the picture, not the app's full accessibility tree, which is most of a snapshot's cost.
    const result = await this.call('get_app_state', {
      app: target.name,
      ...(options?.forViewer ? { max_tree_nodes: VIEWER_TREE_NODES } : {}),
    })
    const capture = this.snapshot(target, result)
    if (!capture) throw new Error(`${target.name} has no window to show.`)
    return capture
  }

  /** The app as a tool result shows it: Open Computer Use answers every action with the app's refreshed state. */
  private snapshot(target: ComputerTarget, result: ToolResult): ComputerCapture | undefined {
    const tree = result.content?.find((part) => part.type === 'text')?.text ?? ''
    const areas = scrollAreas(tree)
    if (areas.length || !this.trees.has(target.name)) this.trees.set(target.name, areas)
    const image = result.content?.find((part) => part.type === 'image' && part.data)
    if (!image?.data) return undefined
    const { width, height } = pngSize(Buffer.from(image.data, 'base64'))
    return {
      mimeType: 'image/png',
      data: image.data,
      width,
      height,
      scale: 1,
      ...(tree.trim() ? { text: tree.slice(0, MAX_COMPUTER_TREE_TEXT) } : {}),
    }
  }

  /** Resolves with the app as the action left it, so a viewer sees the result without waiting for another capture. */
  async perform(target: ComputerTarget, action: ComputerAction): Promise<ComputerCapture | undefined> {
    const result = await this.act(target, action)
    return result && this.snapshot(target, result)
  }

  private async act(target: ComputerTarget, action: ComputerAction): Promise<ToolResult | undefined> {
    const app = target.name
    switch (action.kind) {
      case 'click':
        return this.call('click', {
          app,
          x: action.x,
          y: action.y,
          ...(action.button ? { mouse_button: action.button } : {}),
          ...(action.clickCount ? { click_count: action.clickCount } : {}),
        })
      case 'type':
        try {
          return await this.call('type_text', { app, text: action.text })
        } catch (error) {
          // No focused text field: press the keys instead when every character has one.
          const keys = /focused editable|text entry/i.test(String(error)) ? typingKeys(action.text) : null
          if (!keys) throw error
          let last: ToolResult | undefined
          for (const key of keys) last = await this.call('press_key', { app, key })
          return last
        }
      case 'key':
        return this.call('press_key', { app, key: ocuKey(action.key, action.modifiers) })
      // Open Computer Use posts into the app without moving the person's pointer, so there is nothing to follow.
      case 'move':
        return undefined
      case 'drag':
        return this.call('drag', {
          app,
          from_x: action.fromX,
          from_y: action.fromY,
          to_x: action.toX,
          to_y: action.toY,
        })
      case 'scroll': {
        // Scroll the app's own scroll area, in either direction, when the last observation showed one.
        const area = this.trees.get(app)?.[0]
        const vertical = Math.abs(action.dy) >= Math.abs(action.dx)
        const amount = Math.max(0.25, Math.min(10, Math.abs(vertical ? action.dy : action.dx) / 600))
        const direction = vertical ? (action.dy > 0 ? 'down' : 'up') : action.dx > 0 ? 'right' : 'left'
        if (area) {
          try {
            return await this.call('scroll', { app, element_index: area, direction, pages: amount })
          } catch (error) {
            if (!vertical) throw error
          }
        }
        if (!vertical) throw new Error('Horizontal scrolling needs a scroll area in the app.')
        const times = Math.max(1, Math.min(10, Math.round(Math.abs(action.dy) / 300)))
        let last: ToolResult | undefined
        for (let i = 0; i < times; i++)
          last = await this.call('press_key', { app, key: action.dy > 0 ? 'Page_Down' : 'Page_Up' })
        return last
      }
    }
  }

  releaseInput(): void {
    // Each action is a complete press and release, so nothing is held between calls.
  }

  async close(): Promise<void> {
    const client = await this.client?.catch(() => null)
    this.client = null
    await client?.close().catch(() => {})
  }
}
