// The desktop's dictation engine. Capture runs in the shell page (the microphone is only opened after a person's action
// and only while Electron main holds this take's lease); recognition runs in the main process, on this computer.
// Without the preload voice bridge (a plain browser, tests) the engine reports unsupported and typing is unaffected.

import { VoiceError, UNAVAILABLE_VOICE_ENGINE, type VoiceAudio, type VoiceEngine } from '@ramu/shared/voice/engine'
import { voiceErrorReason, type VoiceBridge } from '@ramu/shared/voice/bridge'

const SAMPLE_RATE = 16_000

/** Anything the bridge or the browser threw, as the typed failure the person sees. */
export const voiceFailure = (error: unknown): VoiceError =>
  error instanceof VoiceError ? error : new VoiceError(voiceErrorReason(error))

interface PcmAudio extends VoiceAudio {
  pcm: Uint8Array
  token: string
}

/** Float samples to little-endian 16-bit PCM, clamped. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2)
  const view = new DataView(out.buffer)
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]!))
    view.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return out
}

export function rmsLevel(samples: Float32Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.min(1, Math.sqrt(sum / samples.length) * 8)
}

export function createDesktopVoiceEngine(
  bridge: VoiceBridge | undefined = typeof window === 'undefined' ? undefined : window.ramu?.voice,
): VoiceEngine {
  if (!bridge) return UNAVAILABLE_VOICE_ENGINE
  return {
    capture: {
      async start(options) {
        let token: string
        try {
          ;({ token } = await bridge.begin(options.language))
        } catch (error) {
          throw voiceFailure(error)
        }
        let stream: MediaStream | undefined
        let context: AudioContext | undefined
        let processor: ScriptProcessorNode | undefined
        let source: MediaStreamAudioSourceNode | undefined
        let halted = false
        const chunks: Uint8Array[] = []
        let bytes = 0
        const halt = () => {
          if (halted) return
          halted = true
          processor?.disconnect()
          source?.disconnect()
          stream?.getTracks().forEach((track) => track.stop())
          void context?.close().catch(() => undefined)
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              ...(options.inputDeviceId ? { deviceId: { exact: options.inputDeviceId } } : {}),
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
            },
          })
          context = new AudioContext({ sampleRate: SAMPLE_RATE })
          source = context.createMediaStreamSource(stream)
          processor = context.createScriptProcessor(4096, 1, 1)
          let limited = false
          processor.onaudioprocess = (event) => {
            if (halted) return
            const samples = event.inputBuffer.getChannelData(0)
            const pcm = toPcm16(samples)
            if (bytes + pcm.length > options.maxBytes) {
              // The cap: keep what fits, stop capturing and wait for Transcribe or Discard.
              const room = Math.max(0, options.maxBytes - bytes) & ~1
              if (room) chunks.push(pcm.subarray(0, room))
              bytes += room
              if (!limited) {
                limited = true
                halt()
                options.onLimit?.()
              }
              return
            }
            chunks.push(pcm)
            bytes += pcm.length
            options.onLevel?.(rmsLevel(samples))
          }
          // The processor only runs while connected to an output; a muted gain keeps it alive without playing anything.
          const mute = context.createGain()
          mute.gain.value = 0
          source.connect(processor)
          processor.connect(mute)
          mute.connect(context.destination)
          // The system took the microphone away (device unplugged, permission revoked, another app took it).
          stream.getAudioTracks().forEach((track) =>
            track.addEventListener('ended', () => {
              if (!halted) {
                halt()
                options.onInterrupt()
              }
            }),
          )
        } catch (error) {
          halt()
          await bridge.cancel(token).catch(() => undefined)
          const name = (error as { name?: string })?.name
          throw new VoiceError(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : 'capture')
        }
        const finished = (): Uint8Array => {
          const pcm = new Uint8Array(bytes)
          let offset = 0
          for (const chunk of chunks) {
            pcm.set(chunk, offset)
            offset += chunk.length
          }
          chunks.length = 0
          return pcm
        }
        return {
          async stop() {
            halt()
            const audio: PcmAudio = {
              pcm: finished(),
              token,
              // Main deletes its temporary file and releases the lease itself; this covers a take never transcribed.
              dispose: () => bridge.cancel(token).catch(() => undefined),
            }
            return audio
          },
          async cancel() {
            halt()
            chunks.length = 0
            await bridge.cancel(token).catch(() => undefined)
          },
        }
      },
    },
    transcriber: {
      capability: (language) =>
        bridge.capability(language).catch(() => ({ readiness: 'unsupported', languages: [], onDevice: false })),
      // Apple's models come with the system; there is nothing Ramu downloads on this platform.
      prepare: () => Promise.reject(new VoiceError('model')),
      async transcribe(audio, language, { signal }) {
        const { pcm, token } = audio as PcmAudio
        try {
          const text = await bridge.transcribe(token, pcm.slice().buffer, language)
          // A cancelled take discards its result even if recognition finished.
          return signal.aborted ? '' : text
        } catch (error) {
          throw voiceFailure(error)
        }
      },
    },
  }
}
