import { afterEach, describe, expect, it, vi } from 'vitest'
import { RTCPeerConnection, RTCRtpCodecParameters } from 'werift'
import type {
  ComputerAction,
  ComputerBackend,
  ComputerCapture,
  ComputerRuntimeStatus,
  ComputerTarget,
} from '@ramu/shared/computerBridge'
import { ComputerRouter } from '../src/computer/router'
import { RtcViewers } from '../src/computer/rtc'
import type { VideoFeed, VideoInfo } from '../src/computer/video'

const target = (kind: 'app' | 'display'): ComputerTarget => ({ id: kind, kind, name: kind })

const backend = (name: string, status: ComputerRuntimeStatus, calls: string[]) =>
  ({
    status: () => status,
    capture: async (t: ComputerTarget) => {
      calls.push(`${name}:capture:${t.kind}`)
      return { mimeType: 'image/jpeg', data: '', width: 1, height: 1, scale: 1 } as ComputerCapture
    },
    perform: async (t: ComputerTarget, _a: ComputerAction) => {
      calls.push(`${name}:perform:${t.kind}`)
    },
    releaseInput: (t: ComputerTarget) => {
      calls.push(`${name}:release:${t.kind}`)
    },
    frameInterval: () => (name === 'apps' ? 900 : undefined),
    apps: async () => ['Calculator'],
  }) as unknown as ComputerBackend & { apps(): Promise<string[]> }

const ready: ComputerRuntimeStatus = { available: true, computer: { id: 'a', name: 'Mac' } }

describe('computer router', () => {
  it('sends app targets to the app backend and the display to the display backend', async () => {
    const calls: string[] = []
    const router = new ComputerRouter(backend('display', ready, calls), backend('apps', ready, calls) as never)
    await router.capture(target('app'))
    await router.capture(target('display'))
    await router.perform(target('app'), { kind: 'key', key: 'a' })
    router.releaseInput(target('display'))
    expect(calls).toEqual([
      'apps:capture:app',
      'display:capture:display',
      'apps:perform:app',
      'display:release:display',
    ])
    expect(await router.listApps()).toEqual(['Calculator'])
  })

  it('reports the display status, a lock first, and otherwise falls back to what app control says', () => {
    const calls: string[] = []
    const apps = backend('apps', { available: false, reason: 'not-installed' }, calls) as never
    const lockedDisplay = { available: false as const, reason: 'locked' as const }
    expect(new ComputerRouter(backend('d', lockedDisplay, calls), apps).status()).toEqual(lockedDisplay)
    expect(new ComputerRouter(backend('d', ready, calls), apps).status()).toEqual(ready)
    const noDisplay = { available: false as const, reason: 'permission-denied' as const }
    expect(new ComputerRouter(backend('d', noDisplay, calls), apps).status()).toEqual({
      available: false,
      reason: 'not-installed',
    })
    expect(new ComputerRouter(backend('d', ready, calls), apps).appStatus()).toEqual({
      available: false,
      reason: 'not-installed',
    })
  })

  it("uses each backend's own frame interval, with a default for one that has none", () => {
    const calls: string[] = []
    const router = new ComputerRouter(backend('display', ready, calls), backend('apps', ready, calls) as never)
    expect(router.frameInterval(target('app'))).toBe(900)
    expect(router.frameInterval(target('display'))).toBe(250)
  })
})

const info: VideoInfo = { width: 640, height: 360 } as VideoInfo
const fakeFeed = () => {
  const unsubscribed = vi.fn()
  const feed = {
    subscribe: vi.fn(async () => ({ info, unsubscribe: unsubscribed })),
    requestKeyFrame: vi.fn(),
    stop: vi.fn(),
  }
  return { feed: feed as unknown as VideoFeed, raw: feed, unsubscribed }
}

// A phone or desktop viewer offers H.264, the one codec the shared hardware stream can answer.
const h264 = () =>
  new RTCRtpCodecParameters({
    mimeType: 'video/H264',
    clockRate: 90000,
    rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }],
    parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  })

const viewerOffer = async () => {
  const pc = new RTCPeerConnection({ codecs: { audio: [], video: [h264()] } })
  pc.addTransceiver('video', { direction: 'recvonly' })
  await pc.setLocalDescription(await pc.createOffer())
  return { pc, sdp: pc.localDescription!.sdp }
}

describe('rtc viewers', () => {
  const closers: (() => Promise<void> | void)[] = []
  afterEach(async () => {
    for (const close of closers.splice(0)) await close()
  })

  it('answers a receive-only offer and lets only the opening device close it or ask for a key frame', async () => {
    const { feed, raw, unsubscribed } = fakeFeed()
    const viewers = new RtcViewers(feed, () => true)
    closers.push(() => viewers.closeAll())
    const { pc, sdp } = await viewerOffer()
    closers.push(() => pc.close())
    const answer = await viewers.answer('thread', 'phone', sdp)
    expect(answer.sdp.toLowerCase()).toContain('h264')
    expect(answer.sdp).not.toContain('a=inactive')
    expect(viewers.count('thread')).toBe(1)

    viewers.keyFrame(answer.id, 'someone-else')
    expect(raw.requestKeyFrame).not.toHaveBeenCalled()
    viewers.keyFrame(answer.id, 'phone')
    expect(raw.requestKeyFrame).toHaveBeenCalledOnce()

    viewers.closeFor(answer.id, 'someone-else')
    expect(viewers.count('thread')).toBe(1)
    viewers.closeFor(answer.id, 'phone')
    expect(viewers.count('thread')).toBe(0)
    expect(unsubscribed).toHaveBeenCalledOnce()
  }, 15000)

  it('refuses an offer without a video line and releases its feed subscription', async () => {
    const { feed } = fakeFeed()
    const viewers = new RtcViewers(feed, () => true)
    closers.push(() => viewers.closeAll())
    const pc = new RTCPeerConnection()
    pc.addTransceiver('audio', { direction: 'recvonly' })
    await pc.setLocalDescription(await pc.createOffer())
    closers.push(() => pc.close())
    await expect(viewers.answer('thread', 'phone', pc.localDescription!.sdp)).rejects.toThrow()
    expect(viewers.count('thread')).toBe(0)
  }, 15000)

  it('closes every viewer of a thread when asked, leaving other threads watching', async () => {
    const { feed } = fakeFeed()
    const viewers = new RtcViewers(feed, () => true)
    closers.push(() => viewers.closeAll())
    for (const thread of ['one', 'one', 'two']) {
      const { pc, sdp } = await viewerOffer()
      closers.push(() => pc.close())
      await viewers.answer(thread, 'phone', sdp)
    }
    viewers.closeThread('one')
    expect(viewers.count('one')).toBe(0)
    expect(viewers.count('two')).toBe(1)
  }, 30000)
})
