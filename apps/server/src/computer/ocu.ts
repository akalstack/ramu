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
import { findExecutable } from '../providers/providerBinaries'

/** The part of an MCP client this backend uses, so a fake can stand in for the native process in tests. */
export interface OcuClient {
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
}

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

export function ocuExecutable(): string | null {
  const configured = process.env.RAMU_OCU_PATH
  if (configured) return findExecutable(configured)
  return (
    findExecutable('ocu') ??
    findExecutable('open-computer-use') ??
    [join(homedir(), '.ramu/tools/node_modules/.bin/ocu'), '/opt/homebrew/bin/ocu', '/usr/local/bin/ocu']
      .map((path) => findExecutable(path))
      .find(Boolean) ??
    null
  )
}

/**
 * Open Computer Use (MIT): acts on one named app through the Accessibility tree and posts input to that app, so the
 * person's own cursor and focus stay theirs. Coordinates are pixels of the app screenshot that capture returns.
 */
export class OcuBackend implements ComputerBackend {
  private client: Promise<OcuClient> | null = null
  constructor(
    private readonly executable: () => string | null = ocuExecutable,
    private readonly connect: (executable: string) => Promise<OcuClient> = async (command) => {
      const client = new Client({ name: 'ramu-computer', version: '0.1.0' }, { capabilities: {} })
      await client.connect(new StdioClientTransport({ command, args: ['mcp'], stderr: 'ignore' }), { timeout: 30_000 })
      return client as unknown as OcuClient
    },
  ) {}

  status(): ComputerRuntimeStatus {
    if (process.platform !== 'darwin')
      return { available: false, reason: 'unsupported', detail: 'App-scoped computer use currently supports macOS.' }
    if (!this.executable())
      return {
        available: false,
        reason: 'not-installed',
        detail: 'Install Open Computer Use (npm i -g open-computer-use) to let agents use one app in the background.',
      }
    return { available: true, computer: { id: 'local', name: 'This computer' } }
  }

  private async session(): Promise<OcuClient> {
    const path = this.executable()
    if (!path) throw new Error('Open Computer Use is not installed.')
    this.client ??= this.connect(path).catch((error) => {
      this.client = null
      throw error
    })
    return this.client
  }

  private async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = await this.session()
    let result: ToolResult
    try {
      result = (await client.callTool({ name, arguments: args })) as ToolResult
    } catch (error) {
      this.client = null
      await client.close().catch(() => {})
      throw error
    }
    if (result.isError) throw new Error(result.content?.find((part) => part.type === 'text')?.text ?? `${name} failed`)
    return result
  }

  async apps(): Promise<string[]> {
    const result = await this.call('list_apps', {})
    return parseApps(result.content?.find((part) => part.type === 'text')?.text ?? '')
  }

  async capture(target: ComputerTarget): Promise<ComputerCapture> {
    const result = await this.call('get_app_state', { app: target.name })
    const image = result.content?.find((part) => part.type === 'image' && part.data)
    if (!image?.data) throw new Error(`${target.name} has no window to show.`)
    const { width, height } = pngSize(Buffer.from(image.data, 'base64'))
    return { mimeType: 'image/png', data: image.data, width, height, scale: 1 }
  }

  async perform(target: ComputerTarget, action: ComputerAction): Promise<void> {
    const app = target.name
    switch (action.kind) {
      case 'click':
        await this.call('click', {
          app,
          x: action.x,
          y: action.y,
          ...(action.button ? { mouse_button: action.button } : {}),
          ...(action.clickCount ? { click_count: action.clickCount } : {}),
        })
        return
      case 'type':
        await this.call('type_text', { app, text: action.text })
        return
      case 'key':
        await this.call('press_key', { app, key: ocuKey(action.key, action.modifiers) })
        return
      case 'drag':
        await this.call('drag', { app, from_x: action.fromX, from_y: action.fromY, to_x: action.toX, to_y: action.toY })
        return
      case 'scroll': {
        // Scrolling by element needs an element index, which pixel coordinates do not give; page keys cover the common case.
        if (action.dx !== 0 && action.dy === 0) throw new Error('Horizontal scrolling is not supported for apps.')
        const times = Math.max(1, Math.min(10, Math.round(Math.abs(action.dy) / 300)))
        for (let i = 0; i < times; i++)
          await this.call('press_key', { app, key: action.dy > 0 ? 'Page_Down' : 'Page_Up' })
        return
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
