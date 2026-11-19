import { spawn, type ChildProcess } from 'node:child_process'
import {
  ComputerNotRun,
  type ComputerAction,
  ComputerBackend,
  ComputerCapture,
  ComputerRuntimeStatus,
  ComputerTarget,
} from '@ramu/shared/computerBridge'
import SOURCE from '../../native/ramu-capture.swift?raw'
import { AWAY_MESSAGE, LOCKED_MESSAGE } from './macos'
import { ensureHelper } from './nativeHelper'

export type CaptureMessage =
  { kind: 1; json: Record<string, unknown> } | { kind: 2; jpeg: Buffer } | { kind: 3; key: boolean; annexB: Buffer }

/** Splits the helper's stdout into messages: u32 big-endian length of (kind byte + payload), kind byte, payload. */
export class FrameParser {
  private buffer: Buffer = Buffer.alloc(0)
  constructor(private readonly maxMessage = 16 * 1024 * 1024) {}

  push(chunk: Buffer): CaptureMessage[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    const out: CaptureMessage[] = []
    for (;;) {
      if (this.buffer.length < 5) break
      const length = this.buffer.readUInt32BE(0)
      if (length < 1 || length > this.maxMessage) throw new Error('The screen stream sent a malformed message.')
      if (this.buffer.length < 4 + length) break
      const kind = this.buffer[4]
      const payload = this.buffer.subarray(5, 4 + length)
      this.buffer = this.buffer.subarray(4 + length)
      if (kind === 1) out.push({ kind: 1, json: JSON.parse(payload.toString('utf8')) as Record<string, unknown> })
      else if (kind === 2) out.push({ kind: 2, jpeg: Buffer.from(payload) })
      else if (kind === 3 && payload.length > 1)
        out.push({ kind: 3, key: payload[0] === 1, annexB: Buffer.from(payload.subarray(1)) })
    }
    return out
  }
}

/** The display and window capture helper, compiled on first use. */
export const ensureCaptureHelper = () => ensureHelper(SOURCE, 'ramu-capture')

export interface StreamFrame {
  data: string
  width: number
  height: number
  scale: number
}

/** One running capture helper. It is stopped a few seconds after the last read, and restarted by the next one. */
export class ScreenStream {
  private child: ChildProcess | null = null
  private latest: StreamFrame | null = null
  private meta: { width: number; height: number; pointsWidth: number } | null = null
  private waiters: ((frame: StreamFrame | Error) => void)[] = []
  private failure: Error | null = null
  private idle: ReturnType<typeof setTimeout> | null = null
  constructor(
    private readonly start: () => Promise<ChildProcess>,
    private readonly idleMs = 8000,
  ) {}

  /** The newest frame, starting the helper if needed. The screen is current: frames arrive whenever it changes. */
  async frame(timeoutMs = 15_000): Promise<StreamFrame> {
    this.touch()
    if (!this.child) await this.launch()
    if (this.failure) throw this.failure
    if (this.latest) return this.latest
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== done)
        reject(new Error('No screen frame arrived.'))
      }, timeoutMs)
      const done = (value: StreamFrame | Error) => {
        clearTimeout(timer)
        value instanceof Error ? reject(value) : resolve(value)
      }
      this.waiters.push(done)
    })
  }

  private touch() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => this.stop(), this.idleMs)
    this.idle.unref?.()
  }

  private async launch() {
    this.failure = null
    this.latest = null
    this.meta = null
    const child = await this.start()
    this.child = child
    const parser = new FrameParser()
    let errorText = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      errorText = (errorText + chunk.toString()).slice(-1000)
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      try {
        for (const message of parser.push(chunk)) {
          if (message.kind === 1)
            this.meta = {
              width: Number(message.json.width),
              height: Number(message.json.height),
              pointsWidth: Number(message.json.pointsWidth),
            }
          else if (message.kind === 2 && this.meta) {
            const { width, height, pointsWidth } = this.meta
            this.latest = {
              data: message.jpeg.toString('base64'),
              width,
              height,
              scale: pointsWidth > 0 ? width / pointsWidth : 1,
            }
            const waiting = this.waiters
            this.waiters = []
            for (const waiter of waiting) waiter(this.latest)
          }
        }
      } catch (error) {
        this.end(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.once('exit', () => {
      if (this.child === child) this.end(new Error(errorText.trim() || 'The screen stream ended.'))
    })
    child.once('error', (error) => {
      if (this.child === child) this.end(error)
    })
  }

  private end(error: Error) {
    const child = this.child
    this.child = null
    this.latest = null
    this.failure = error
    child?.kill()
    const waiting = this.waiters
    this.waiters = []
    for (const waiter of waiting) waiter(error)
  }

  stop() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const child = this.child
    this.child = null
    this.latest = null
    this.failure = null
    child?.stdin?.end()
    child?.kill()
  }
}

/**
 * Display capture from a ScreenCaptureKit helper: frames of the main display at up to 15 a second, produced only when
 * the screen changes, so a viewer reads the current frame instead of paying for a capture. Input and status stay with
 * the wrapped backend. When the helper cannot be built or started, capture falls back to the wrapped backend.
 */
export class SckDisplayBackend implements ComputerBackend {
  private stream: ScreenStream | null = null
  private broken = false
  constructor(
    private readonly inner: ComputerBackend & { useScale?(scale: number): void },
    private readonly build: () => Promise<string> = ensureCaptureHelper,
    private readonly launch: (path: string) => ChildProcess = (path) =>
      spawn(path, ['--max-edge', '1600', '--fps', '15', '--quality', '0.6'], { stdio: ['pipe', 'pipe', 'pipe'] }),
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  status(): ComputerRuntimeStatus {
    return this.inner.status()
  }

  useScale(scale: number): void {
    this.inner.useScale?.(scale)
  }

  locked(): Promise<boolean> {
    return this.inner.locked?.() ?? Promise.resolve(false)
  }

  awayFromScreen(): Promise<boolean> {
    return this.inner.awayFromScreen?.() ?? Promise.resolve(false)
  }

  /** Builds the helpers in the background so the first viewer and the first click do not wait for the compiler. */
  warm(): void {
    if (this.platform === 'darwin') void this.build().catch(() => {})
    this.inner.warm?.()
  }

  /** Frames are already cheap, so a watched display can be read near the stream rate. */
  frameInterval(target: ComputerTarget): number {
    return target.kind === 'display' && !this.broken ? 66 : 250
  }

  async capture(target: ComputerTarget): Promise<ComputerCapture> {
    // The stream would show the lock screen; say so instead of presenting it as the person's desktop.
    if (await this.inner.locked?.())
      throw new ComputerNotRun((await this.inner.awayFromScreen?.()) ? AWAY_MESSAGE : LOCKED_MESSAGE)
    if (this.broken || this.platform !== 'darwin' || target.kind !== 'display') return this.inner.capture(target)
    this.stream ??= new ScreenStream(async () => this.launch(await this.build()))
    try {
      const frame = await this.stream.frame()
      this.inner.useScale?.(frame.scale)
      return { mimeType: 'image/jpeg', ...frame }
    } catch {
      // Not built, not allowed or not running: use the slower one-shot capture, and look again later.
      this.stream?.stop()
      this.stream = null
      this.broken = true
      setTimeout(() => (this.broken = false), 60_000).unref?.()
      return this.inner.capture(target)
    }
  }

  perform(
    target: ComputerTarget,
    action: ComputerAction,
    options?: { byPerson?: boolean },
  ): Promise<ComputerCapture | void> {
    return this.inner.perform(target, action, options)
  }
  focusedField(target: ComputerTarget) {
    return this.inner.focusedField?.(target) ?? Promise.resolve({ editable: false })
  }

  releaseInput(target: ComputerTarget): void {
    this.inner.releaseInput(target)
  }
}
