// The person's own input on a test device, over the lease's input socket in serve-sim's messages: a touch lands as
// the finger moves instead of after an agent-device round trip. Agents keep acting through agent-device.
import WebSocket from 'ws'

/** serve-sim's message tags, as Simlock's input socket takes them: one tag byte, then JSON. */
const TAG = { touch: 0x03, button: 0x04, key: 0x06, scroll: 0x0b } as const
/** HID usage for Return. */
const RETURN_USAGE = 0x28

export type DeviceButton = 'home' | 'back' | 'app_switcher' | 'lock'

/** A point on the screen as fractions of its width and height, as the socket takes it. */
export interface Fraction {
  x: number
  y: number
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function inputMessage(tag: number, body: Record<string, unknown>): Buffer {
  return Buffer.concat([Buffer.from([tag]), Buffer.from(JSON.stringify(body))])
}

/** One lease's input socket, opened on first use with the thread's own token and reopened after it drops. */
export class DeviceInput {
  private socket: WebSocket | null = null
  private opening: Promise<WebSocket> | null = null

  constructor(
    private readonly url: string,
    /** The thread's token: only a lease's holder may send it input. */
    private readonly token: string,
    private readonly connect: (url: string, token: string) => WebSocket = (address, secret) =>
      new WebSocket(address, { headers: { authorization: `Bearer ${secret}` } }),
  ) {}

  private open(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket)
    this.opening ??= new Promise<WebSocket>((resolve, reject) => {
      const socket = this.connect(this.url, this.token)
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error('The test device did not take input in time.'))
      }, 10_000)
      socket.once('open', () => {
        clearTimeout(timer)
        this.socket = socket
        resolve(socket)
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      socket.once('close', () => {
        if (this.socket === socket) this.socket = null
      })
    }).finally(() => {
      this.opening = null
    })
    return this.opening
  }

  private async send(...messages: Buffer[]) {
    const socket = await this.open()
    for (const message of messages) socket.send(message)
  }

  tap(at: Fraction) {
    const point = { x: clamp(at.x), y: clamp(at.y) }
    return this.send(
      inputMessage(TAG.touch, { type: 'begin', ...point }),
      inputMessage(TAG.touch, { type: 'end', ...point }),
    )
  }

  /** A finger drawn from one point to another in a few steps, so lists and sliders follow it. */
  async drag(from: Fraction, to: Fraction, steps = 8) {
    const messages = [inputMessage(TAG.touch, { type: 'begin', x: clamp(from.x), y: clamp(from.y) })]
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      messages.push(
        inputMessage(TAG.touch, {
          type: 'move',
          x: clamp(from.x + (to.x - from.x) * t),
          y: clamp(from.y + (to.y - from.y) * t),
        }),
      )
    }
    messages.push(inputMessage(TAG.touch, { type: 'end', x: clamp(to.x), y: clamp(to.y) }))
    await this.send(...messages)
  }

  /** A wheel or trackpad scroll, as fractions of the screen per event. */
  scroll(at: Fraction, dx: number, dy: number) {
    const delta = (value: number) => Math.min(1, Math.max(-1, value))
    return this.send(inputMessage(TAG.scroll, { x: clamp(at.x), y: clamp(at.y), dx: delta(dx), dy: delta(dy) }))
  }

  button(button: DeviceButton) {
    return this.send(inputMessage(TAG.button, { button }))
  }

  enter() {
    return this.send(
      inputMessage(TAG.key, { type: 'down', usage: RETURN_USAGE }),
      inputMessage(TAG.key, { type: 'up', usage: RETURN_USAGE }),
    )
  }

  close() {
    this.socket?.close()
    this.socket = null
  }
}
