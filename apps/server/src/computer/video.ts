import { spawn, type ChildProcess } from 'node:child_process'
import { RtpHeader, RtpPacket } from 'werift'
import { ensureCaptureHelper, FrameParser } from './sck'

/** Splits an Annex-B byte stream into NAL units without their start codes. */
export function splitNalus(data: Buffer): Buffer[] {
  const units: Buffer[] = []
  let start = -1
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
      const codeLength = data[i + 2] === 1 ? 3 : 4
      if (start >= 0) units.push(data.subarray(start, i))
      start = i + codeLength
      i += codeLength - 1
    }
  }
  if (start >= 0 && start < data.length) units.push(data.subarray(start))
  return units.filter((unit) => unit.length > 0)
}

const MAX_PAYLOAD = 1150

export interface PacketizerState {
  sequence: number
  ssrc: number
  payloadType: number
}

/**
 * RTP packets for one H.264 access unit (RFC 6184, packetization-mode 1): a small NAL unit is one packet, a large one
 * is split into FU-A fragments, and the last packet of the access unit carries the marker bit.
 */
export function packetizeH264(nalus: Buffer[], timestamp: number, state: PacketizerState): RtpPacket[] {
  const payloads: Buffer[] = []
  for (const nal of nalus) {
    if (nal.length <= MAX_PAYLOAD) {
      payloads.push(nal)
      continue
    }
    const header = nal[0]!
    const indicator = (header & 0xe0) | 28
    const type = header & 0x1f
    let offset = 1
    while (offset < nal.length) {
      const size = Math.min(MAX_PAYLOAD - 2, nal.length - offset)
      const first = offset === 1
      const last = offset + size >= nal.length
      payloads.push(
        Buffer.concat([
          Buffer.from([indicator, (first ? 0x80 : 0) | (last ? 0x40 : 0) | type]),
          nal.subarray(offset, offset + size),
        ]),
      )
      offset += size
    }
  }
  return payloads.map((payload, index) => {
    const header = new RtpHeader({
      payloadType: state.payloadType,
      sequenceNumber: state.sequence,
      timestamp,
      ssrc: state.ssrc,
      marker: index === payloads.length - 1,
    })
    state.sequence = (state.sequence + 1) & 0xffff
    return new RtpPacket(header, payload)
  })
}

export interface VideoUnit {
  key: boolean
  nalus: Buffer[]
}

export interface VideoInfo {
  width: number
  height: number
  scale: number
}

/** What a feed shows: the main display, or one app's window at an exact size (that of the app's snapshots). */
export type VideoSource = { kind: 'display' } | { kind: 'window'; app: string; width: number; height: number }

const helperArgs = (source: VideoSource) => [
  '--h264',
  '--max-edge',
  '1600',
  '--fps',
  '30',
  '--bitrate',
  '2500000',
  ...(source.kind === 'window' ? ['--window', source.app, '--size', `${source.width}x${source.height}`] : []),
]

/**
 * One hardware H.264 stream of the main display or one app window, shared by every viewer of it. It starts with the first viewer, asks the helper
 * for a key frame when another joins, and stops a few seconds after the last one leaves.
 */
export class VideoFeed {
  private child: ChildProcess | null = null
  private info: VideoInfo | null = null
  private readonly listeners = new Set<(unit: VideoUnit) => void>()
  private infoWaiters: ((info: VideoInfo | Error) => void)[] = []
  private idle: ReturnType<typeof setTimeout> | null = null
  constructor(
    source: VideoSource = { kind: 'display' },
    private readonly launch: () => Promise<ChildProcess> = async () =>
      spawn(await ensureCaptureHelper(), helperArgs(source), { stdio: ['pipe', 'pipe', 'pipe'] }),
    private readonly idleMs = 4000,
  ) {}

  /** Subscribes to access units. Resolves with the picture size once the stream is up. */
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
      if (!this.child) await this.start()
      const info =
        this.info ??
        (await new Promise<VideoInfo>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('No video arrived from the screen.')), 20_000)
          this.infoWaiters.push((value) => {
            clearTimeout(timer)
            value instanceof Error ? reject(value) : resolve(value)
          })
        }))
      this.child?.stdin?.write('K\n')
      return { info, unsubscribe }
    } catch (error) {
      unsubscribe()
      throw error
    }
  }

  private async start() {
    this.info = null
    const child = await this.launch()
    this.child = child
    const parser = new FrameParser()
    let errorText = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (process.env.RAMU_DEBUG_VIDEO) console.error(`[video:helper] ${chunk.toString().trim()}`)
      errorText = (errorText + chunk.toString()).slice(-1000)
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      try {
        for (const message of parser.push(chunk)) {
          if (message.kind === 1) {
            const width = Number(message.json.width)
            const pointsWidth = Number(message.json.pointsWidth)
            this.info = { width, height: Number(message.json.height), scale: pointsWidth > 0 ? width / pointsWidth : 1 }
            const waiting = this.infoWaiters
            this.infoWaiters = []
            for (const waiter of waiting) waiter(this.info)
          } else if (message.kind === 3) {
            const unit = { key: message.key, nalus: splitNalus(message.annexB) }
            if (process.env.RAMU_DEBUG_VIDEO)
              console.error(
                `[video] unit key=${unit.key} nalus=${unit.nalus.length} bytes=${message.annexB.length} listeners=${this.listeners.size}`,
              )
            for (const listener of [...this.listeners]) listener(unit)
          }
        }
      } catch (error) {
        this.end(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.once('exit', () => {
      if (this.child === child) this.end(new Error(errorText.trim() || 'The video stream ended.'))
    })
    child.once('error', (error) => {
      if (this.child === child) this.end(error)
    })
  }

  private end(error: Error) {
    const child = this.child
    this.child = null
    this.info = null
    child?.kill()
    const waiting = this.infoWaiters
    this.infoWaiters = []
    for (const waiter of waiting) waiter(error)
  }

  stop() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const child = this.child
    this.child = null
    this.info = null
    child?.stdin?.end()
    child?.kill()
  }

  requestKeyFrame() {
    this.child?.stdin?.write('K\n')
  }
}
