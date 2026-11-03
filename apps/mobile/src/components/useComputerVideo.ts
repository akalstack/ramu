import { useEffect, useRef, useState } from 'react'
import { NativeModules, Platform } from 'react-native'
import { useStore } from '../runtime/store'

export interface ComputerVideo {
  status: 'off' | 'connecting' | 'live' | 'failed'
  /** A value for `RTCView`'s `streamURL`. */
  streamURL: string | null
  width: number
  height: number
}

const OFF: ComputerVideo = { status: 'off', streamURL: null, width: 0, height: 0 }

/** The event-target part of react-native-webrtc's peer connection, which its published types leave out. */
interface PeerEvents<Track> {
  connectionState: string
  iceGatheringState: string
  addEventListener(type: 'track', listener: (event: { streams?: { toURL(): string }[]; track: Track }) => void): void
  addEventListener(type: 'connectionstatechange' | 'icegatheringstatechange', listener: () => void): void
}
const CONNECT_TIMEOUT_MS = 12_000

/** The native WebRTC module is only in an EAS development or production build; Expo Go has none and gets the image frames. */
export function webrtc(): typeof import('react-native-webrtc') | null {
  // Metro reports failed native module imports before a surrounding catch can hide the red screen.
  // Probe the same registration the package uses before evaluating any of its native components.
  if (Platform.OS === 'web' || !NativeModules.WebRTCModule) return null
  try {
    // Load only after the native registration check; a static import crashes builds without WebRTC.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native-webrtc') as typeof import('react-native-webrtc')
    return typeof module.RTCPeerConnection === 'function' ? module : null
  } catch {
    return null
  }
}

/** Smooth H.264 video of the host's main display. `failed` (or `off`) means the viewer should poll image frames instead. */
export function useComputerVideo(
  computerId: string,
  taskId: string,
  eligible: boolean,
  active: boolean,
): ComputerVideo {
  const store = useStore()
  const io = useRef(store)
  io.current = store
  const [state, setState] = useState<ComputerVideo>(OFF)
  useEffect(() => {
    const native = eligible && active ? webrtc() : null
    if (!native) {
      setState(OFF)
      return
    }
    let mounted = true
    let peerId: string | null = null
    let pc: InstanceType<typeof native.RTCPeerConnection>
    try {
      pc = new native.RTCPeerConnection({ iceServers: [] })
      pc.addTransceiver('video', { direction: 'recvonly' })
    } catch {
      setState({ ...OFF, status: 'failed' })
      return
    }
    const fail = () =>
      mounted && setState((previous) => ({ ...OFF, width: previous.width, height: previous.height, status: 'failed' }))
    const timer = setTimeout(() => {
      if (mounted) setState((previous) => (previous.status === 'live' ? previous : { ...OFF, status: 'failed' }))
    }, CONNECT_TIMEOUT_MS)
    const events = pc as unknown as PeerEvents<InstanceType<typeof native.MediaStreamTrack>>
    events.addEventListener('track', (event) => {
      const stream = event.streams?.[0] ?? new native.MediaStream([event.track])
      if (mounted) setState((previous) => ({ ...previous, status: 'live', streamURL: stream.toURL() }))
    })
    events.addEventListener('connectionstatechange', () => {
      if (['failed', 'disconnected', 'closed'].includes(events.connectionState)) fail()
    })
    setState({ ...OFF, status: 'connecting' })
    void (async () => {
      try {
        await pc.setLocalDescription(await pc.createOffer({ offerToReceiveVideo: true }))
        await new Promise<void>((resolve) => {
          if (events.iceGatheringState === 'complete') return resolve()
          events.addEventListener('icegatheringstatechange', () => events.iceGatheringState === 'complete' && resolve())
          setTimeout(resolve, 3000)
        })
        const answer = await io.current.invoke(computerId, 'computer.rtcOffer', taskId, pc.localDescription!.sdp)
        peerId = answer.id
        if (!mounted) {
          void io.current.invoke(computerId, 'computer.rtcClose', taskId, answer.id).catch(() => {})
          return
        }
        setState((previous) => ({ ...previous, width: answer.width, height: answer.height }))
        await pc.setRemoteDescription(new native.RTCSessionDescription({ type: 'answer', sdp: answer.sdp }))
      } catch {
        fail()
      }
    })()
    return () => {
      mounted = false
      clearTimeout(timer)
      pc.close()
      if (peerId) void io.current.invoke(computerId, 'computer.rtcClose', taskId, peerId).catch(() => {})
    }
  }, [computerId, taskId, eligible, active])
  return state
}
