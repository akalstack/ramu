import { randomUUID, randomBytes } from 'node:crypto'
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters } from 'werift'
import { packetizeH264, type PacketizerState, type VideoFeed, type VideoInfo } from './video'

const MAX_PEERS_PER_THREAD = 4
const GATHER_TIMEOUT_MS = 4000
const CHECK_MS = 2000
const H264 = () =>
  new RTCRtpCodecParameters({
    mimeType: 'video/H264',
    clockRate: 90000,
    rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'goog-remb' }],
    parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  })

interface Peer {
  id: string
  threadId: string
  deviceId: string
  pc: RTCPeerConnection
  unsubscribe(): void
}

/**
 * Video viewers over WebRTC. The viewer offers a receive-only video line over the authenticated host connection and this
 * answers with the shared hardware H.264 stream. Candidates are gathered before answering, so nothing else is exchanged.
 * A peer ends when its connection fails or closes, or when its thread no longer allows viewing.
 */
export class RtcViewers {
  private peers = new Map<string, Peer>()
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(
    private readonly feed: VideoFeed,
    /** True while the thread's grant still lets this device watch. */
    private readonly allowed: (threadId: string, deviceId: string) => boolean,
    private readonly iceServers: { urls: string | string[] }[] = [],
  ) {}

  count(threadId: string): number {
    return [...this.peers.values()].filter((peer) => peer.threadId === threadId).length
  }

  async answer(threadId: string, deviceId: string, offer: string): Promise<{ id: string; sdp: string } & VideoInfo> {
    if (this.count(threadId) >= MAX_PEERS_PER_THREAD) throw new Error('Too many viewers are watching this computer.')
    const pc = new RTCPeerConnection({ codecs: { audio: [], video: [H264()] }, iceServers: this.iceServers })
    const id = randomUUID()
    const track = new MediaStreamTrack({ kind: 'video' })
    const state: PacketizerState = {
      sequence: randomBytes(2).readUInt16BE(0),
      ssrc: randomBytes(4).readUInt32BE(0),
      payloadType: 96,
    }
    let subscription: { info: VideoInfo; unsubscribe(): void } | null = null
    const close = () => this.close(id)
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offer })
      const transceiver = pc.getTransceivers().find((entry) => entry.kind === 'video')
      if (!transceiver) throw new Error('The viewer did not ask for video.')
      transceiver.direction = 'sendonly'
      transceiver.sender.registerTrack(track)
      const codec = transceiver.codecs[0]
      if (codec) state.payloadType = codec.payloadType
      let connected = false
      let started = false
      pc.connectionStateChange.subscribe((connection) => {
        if (connection === 'connected') {
          connected = true
          started = false
          // A key frame sent before the connection was up is gone, and a still screen makes no new one: ask again now
          // and a couple more times in case the first request races the receiver's decoder starting.
          for (const delay of [0, 400, 1200]) setTimeout(() => this.keyFrame(id, deviceId), delay).unref?.()
        }
        if (connection === 'failed' || connection === 'closed' || connection === 'disconnected') close()
      })
      const start = Date.now()
      subscription = await this.feed.subscribe((unit) => {
        // A viewer can only start decoding at a key frame; send nothing until the first one.
        if (!connected || (!started && !unit.key)) return
        started = true
        const timestamp = Math.floor(((Date.now() - start) * 90) % 0xffffffff)
        for (const packet of packetizeH264(unit.nalus, timestamp, state)) track.writeRtp(packet)
      })
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await Promise.race([
        new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') resolve()
          else pc.iceGatheringStateChange.subscribe((value) => value === 'complete' && resolve())
        }),
        new Promise<void>((resolve) => setTimeout(resolve, GATHER_TIMEOUT_MS)),
      ])
      const description = pc.localDescription
      if (!description) throw new Error('The video connection could not be prepared.')
      this.peers.set(id, { id, threadId, deviceId, pc, unsubscribe: subscription.unsubscribe })
      this.watch()
      return { id, sdp: description.sdp, ...subscription.info }
    } catch (error) {
      subscription?.unsubscribe()
      await pc.close().catch(() => {})
      throw error
    }
  }

  /** The viewer asks for a fresh key frame, for example after packet loss. Only its own peer can ask. */
  keyFrame(id: string, deviceId: string) {
    if (this.peers.get(id)?.deviceId === deviceId) this.feed.requestKeyFrame()
  }

  /** Only the device that opened a peer can close it. */
  closeFor(id: string, deviceId: string) {
    if (this.peers.get(id)?.deviceId === deviceId) this.close(id)
  }

  close(id: string) {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    peer.unsubscribe()
    void peer.pc.close().catch(() => {})
    if (!this.peers.size && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  closeThread(threadId: string) {
    for (const peer of [...this.peers.values()]) if (peer.threadId === threadId) this.close(peer.id)
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.close(id)
    this.feed.stop()
  }

  private watch() {
    if (this.timer) return
    this.timer = setInterval(() => {
      for (const peer of [...this.peers.values()]) if (!this.allowed(peer.threadId, peer.deviceId)) this.close(peer.id)
    }, CHECK_MS)
    this.timer.unref?.()
  }
}
