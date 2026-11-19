import type { BrowserLiveFrame } from '@ramu/shared/browserBridge'

export interface CompositorFrame {
  data: string
  sessionId: number
  metadata: { deviceWidth: number; deviceHeight: number }
}
export interface FrameProtocol {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  listen(receive: (frame: CompositorFrame) => void): () => void
}

/** One private compositor feed per tab. Keep only the newest frame, never a video backlog. */
export class BrowserFrames {
  private latest: BrowserLiveFrame | null = null
  private sequence = 0
  private running: Promise<void> | null = null
  private closed = false
  private requests = 0
  private failure: Error | null = null
  private stopping: Promise<void> | null = null
  private off: (() => void) | null = null
  private idle: ReturnType<typeof setTimeout> | undefined
  private readonly acks = new Set<ReturnType<typeof setTimeout>>()
  private readonly waiters = new Set<(error?: Error) => void>()
  constructor(private readonly protocol: FrameProtocol) {}

  async next(after: number): Promise<BrowserLiveFrame | null> {
    if (this.closed) throw new Error('That browser tab is closed.')
    if (this.requests >= 8) throw new Error('Too many viewers are watching this browser tab.')
    this.requests++
    clearTimeout(this.idle)
    try {
      await this.stopping
      if (this.closed) throw new Error('That browser tab is closed.')
      this.running ??= this.start()
      await this.running
      if (this.closed) throw new Error('That browser tab is closed.')
      if (this.failure) throw this.failure
      if (!this.latest || this.latest.sequence <= after) {
        await new Promise<void>((resolve, reject) => {
          const done = (error?: Error) => {
            clearTimeout(timer)
            this.waiters.delete(done)
            if (error) reject(error)
            else resolve()
          }
          const timer = setTimeout(done, 1000)
          this.waiters.add(done)
        })
      }
      if (this.failure) throw this.failure
      return this.latest && this.latest.sequence > after ? this.latest : null
    } finally {
      // No viewer has asked again: stop capture, including when a client disappeared without disconnecting.
      clearTimeout(this.idle)
      if (--this.requests === 0 && !this.closed) {
        this.idle = setTimeout(() => void this.stop(), 1500)
        this.idle.unref?.()
      }
    }
  }

  private async start() {
    this.failure = null
    this.off = this.protocol.listen((frame) => {
      if (this.closed) return
      // Acknowledgements apply compositor backpressure; the viewer separately caps display at roughly 30 fps.
      const ack = setTimeout(() => {
        this.acks.delete(ack)
        void this.protocol.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
      }, 33)
      this.acks.add(ack)
      const { deviceWidth: width, deviceHeight: height } = frame.metadata
      if (!frame.data || frame.data.length > 180_000 || !(width > 0 && height > 0)) {
        this.failure = new Error('The live browser frame is unavailable.')
        for (const done of [...this.waiters]) done(this.failure)
        return
      }
      this.latest = { mimeType: 'image/jpeg', data: frame.data, width, height, sequence: ++this.sequence }
      for (const done of [...this.waiters]) done()
    })
    try {
      await this.protocol.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
      })
    } catch (error) {
      this.off?.()
      this.off = null
      this.running = null
      throw error
    }
  }

  private async stop() {
    const running = this.running
    if (!running || this.stopping) return this.stopping
    this.running = null
    // Keep start/stop serialized. A returning viewer starts a fresh feed after the stop finishes.
    this.off?.()
    this.off = null
    for (const ack of this.acks) clearTimeout(ack)
    this.acks.clear()
    this.latest = null
    for (const done of [...this.waiters]) done()
    const stopping = running
      .catch(() => {})
      .then(() => this.protocol.send('Page.stopScreencast'))
      .then(
        () => {},
        () => {},
      )
    this.stopping = stopping
    await stopping
    if (this.stopping === stopping) this.stopping = null
  }

  close() {
    this.closed = true
    clearTimeout(this.idle)
    for (const done of [...this.waiters]) done(new Error('That browser tab is closed.'))
    void this.stop()
  }
}
