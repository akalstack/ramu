import { useEffect, useState } from 'react'
import { useHost } from '../workspace/HostProvider'

export interface ComputerVideo {
  status: 'off' | 'connecting' | 'live' | 'failed'
  stream: MediaStream | null
  /** Size of the picture the host encodes, which is the coordinate space for input. */
  width: number
  height: number
}

const OFF: ComputerVideo = { status: 'off', stream: null, width: 0, height: 0 }
const CONNECT_TIMEOUT_MS = 10_000
/** After video fails the viewer uses image frames, and tries video again this much later (an app window after unlock). */
const RETRY_MS = 15_000

/**
 * Smooth video of the host's main display, or of the granted app's window, over WebRTC. The offer and answer go through the authenticated host connection;
 * when the connection cannot be made, `failed` tells the viewer to use the image frames instead.
 */
export function useComputerVideo(taskId: string, eligible: boolean): ComputerVideo {
  const { invoke } = useHost()
  const [state, setState] = useState<ComputerVideo>(OFF)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!eligible || typeof RTCPeerConnection === 'undefined') {
      setState(OFF)
      return
    }
    let active = true
    let peerId: string | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    const pc = new RTCPeerConnection()
    const fail = () => {
      if (!active) return
      setState((previous) =>
        previous.status === 'live' ? { ...previous, status: 'failed' } : { ...OFF, status: 'failed' },
      )
      retry ??= setTimeout(() => setAttempt((value) => value + 1), RETRY_MS)
    }
    const timer = setTimeout(() => {
      if (active && pc.connectionState !== 'connected') fail()
    }, CONNECT_TIMEOUT_MS)
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.ontrack = (event) => {
      if (!active) return
      const stream = event.streams[0] ?? new MediaStream([event.track])
      setState((previous) => ({ ...previous, status: 'live', stream }))
    }
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) fail()
    }
    setState({ ...OFF, status: 'connecting' })
    void (async () => {
      try {
        await pc.setLocalDescription(await pc.createOffer())
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve()
          pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve()
          setTimeout(resolve, 3000)
        })
        const answer = await invoke('computer.rtcOffer', taskId, pc.localDescription!.sdp)
        peerId = answer.id
        if (!active) {
          void invoke('computer.rtcClose', taskId, answer.id).catch(() => {})
          return
        }
        setState((previous) => ({ ...previous, width: answer.width, height: answer.height }))
        await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
      } catch {
        fail()
      }
    })()
    return () => {
      active = false
      clearTimeout(timer)
      clearTimeout(retry)
      pc.close()
      if (peerId) void invoke('computer.rtcClose', taskId, peerId).catch(() => {})
    }
  }, [invoke, taskId, eligible, attempt])
  return state
}
