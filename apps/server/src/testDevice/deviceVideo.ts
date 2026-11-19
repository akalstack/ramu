// A test device's screen as live video: Simlock's H.264 stream for the thread's lease, turned into the access units
// Ramu's WebRTC viewers already send, so the desktop viewer, Float and the phone decode it as they do a Mac's screen.
import type { LiveFeed, VideoInfo, VideoUnit } from '../computer/video'

/** Simlock's frame tags: a 4-byte length (payload + 1), one tag byte, then the payload. */
const TAG = { description: 0x01, keyframe: 0x02, delta: 0x03, meta: 0x05, ended: 0x07 } as const
const HEADER = 5
const MAX_FRAME = 8 * 1024 * 1024
const START_CODE = Buffer.from([0, 0, 0, 1])

/** SPS and PPS from an avcC record, as NAL units without start codes. */
export function parameterSets(avcc: Uint8Array): Buffer[] {
  const bytes = Buffer.from(avcc)
  if (bytes.length < 7 || bytes[0] !== 1) throw new Error('The device sent an unreadable video description.')
  const units: Buffer[] = []
  let offset = 5
  // Byte 5 counts the SPS (low five bits); the byte after them counts the PPS.
  for (const count of ['sps', 'pps'] as const) {
    const sets = count === 'sps' ? bytes[offset]! & 0x1f : bytes[offset]!
    offset += 1
    for (let index = 0; index < sets; index++) {
      const length = bytes.readUInt16BE(offset)
      units.push(bytes.subarray(offset + 2, offset + 2 + length))
      offset += 2 + length
    }
  }
  return units
}

/** NAL units from length-prefixed (AVCC, 4-byte lengths) access-unit bytes. */
export function avccUnits(payload: Uint8Array): Buffer[] {
  const bytes = Buffer.from(payload)
  const units: Buffer[] = []
  for (let offset = 0; offset + 4 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    if (!length || offset + 4 + length > bytes.length) break
    units.push(bytes.subarray(offset + 4, offset + 4 + length))
    offset += 4 + length
  }
  return units
}

/** Splits Simlock's stream into frames as they arrive, across chunk boundaries. */
export class FrameReader {
  private buffer = Buffer.alloc(0)

  push(chunk: Uint8Array): { tag: number; payload: Buffer }[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    const frames: { tag: number; payload: Buffer }[] = []
    while (this.buffer.length >= HEADER) {
      const length = this.buffer.readUInt32BE(0)
      if (length < 1 || length > MAX_FRAME) throw new Error('The device sent video Ramu cannot read.')
      const total = HEADER + length - 1
      if (this.buffer.length < total) break
      frames.push({ tag: this.buffer[4]!, payload: this.buffer.subarray(HEADER, total) })
      this.buffer = this.buffer.subarray(total)
    }
    return frames
  }
}

/** Joined back into one Annex-B buffer, for tests and debugging. */
export const annexB = (units: Buffer[]) => Buffer.concat(units.flatMap((unit) => [START_CODE, unit]))

/**
 * One device's stream, shared by everyone watching that thread. It connects with the first viewer, reconnects when a
 * viewer needs a key frame (a fresh connection starts with one), and stops a few seconds after the last viewer leaves.
 */
export class DeviceVideoFeed implements LiveFeed {
  private abort: AbortController | null = null
  private info: VideoInfo | null = null
  private parameters: Buffer[] = []
  private readonly listeners = new Set<(unit: VideoUnit) => void>()
  private waiters: ((info: VideoInfo | Error) => void)[] = []
  private idle: ReturnType<typeof setTimeout> | null = null
  private lastKey = 0

  constructor(
    /** Opens the lease's stream; the server adds the token. */
    private readonly open: (signal: AbortSignal) => Promise<Response>,
    /** Screen points across, so a point in the video maps to a point on the device. */
    private readonly pointsWide: () => number | null,
    private readonly idleMs = 4000,
  ) {}

  async subscribe(listener: (unit: VideoUnit) => void): Promise<{ info: VideoInfo; unsubscribe(): void }> {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    this.listeners.add(listener)
    const unsubscribe = () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) {
        this.idle = setTimeout(() => this.stop(), this.idleMs)
        this.idle.unref?.()
      }
    }
    try {
      if (!this.abort) this.connect()
      const info =
        this.info ??
        (await new Promise<VideoInfo>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('No video arrived from the test device.')), 20_000)
          this.waiters.push((value) => {
            clearTimeout(timer)
            value instanceof Error ? reject(value) : resolve(value)
          })
        }))
      return { info, unsubscribe }
    } catch (error) {
      unsubscribe()
      throw error
    }
  }

  private connect() {
    const controller = new AbortController()
    this.abort = controller
    void (async () => {
      try {
        const response = await this.open(controller.signal)
        if (!response.ok || !response.body) throw new Error('The test device’s screen could not be streamed.')
        const reader = response.body.getReader()
        const frames = new FrameReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          for (const frame of frames.push(value)) this.onFrame(frame.tag, frame.payload)
        }
        if (this.abort === controller) this.fail(new Error('The test device’s screen ended.'))
      } catch (error) {
        if (this.abort === controller) this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  }

  private onFrame(tag: number, payload: Buffer) {
    if (tag === TAG.meta) {
      const meta = JSON.parse(payload.toString('utf8')) as { width: number; height: number }
      const points = this.pointsWide()
      this.info = { width: meta.width, height: meta.height, scale: points ? meta.width / points : 1 }
      const waiting = this.waiters
      this.waiters = []
      for (const waiter of waiting) waiter(this.info)
    } else if (tag === TAG.description) this.parameters = parameterSets(payload)
    else if (tag === TAG.keyframe || tag === TAG.delta) {
      const key = tag === TAG.keyframe
      if (key) this.lastKey = Date.now()
      // A decoder that joins at a key frame needs the parameter sets with it.
      const unit = { key, nalus: key ? [...this.parameters, ...avccUnits(payload)] : avccUnits(payload) }
      for (const listener of [...this.listeners]) listener(unit)
    } else if (tag === TAG.ended) this.fail(new Error('The test device was given back.'))
  }

  private fail(error: Error) {
    this.abort = null
    this.info = null
    const waiting = this.waiters
    this.waiters = []
    for (const waiter of waiting) waiter(error)
  }

  /** A fresh connection begins with a key frame; one recent enough is still on its way to the viewer. */
  requestKeyFrame() {
    if (!this.listeners.size || Date.now() - this.lastKey < 1500) return
    this.lastKey = Date.now()
    this.abort?.abort()
    this.abort = null
    this.connect()
  }

  stop() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    this.abort?.abort()
    this.abort = null
    this.info = null
  }
}
