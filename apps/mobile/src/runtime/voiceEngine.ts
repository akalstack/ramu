// The phone's dictation engine: the Ramu-owned `RamuSpeech` native module (on-device recognition only). Expo Go and
// mobile web have no such module, so the engine reports unsupported, the microphone stays hidden and typing is
// unaffected. Audio never leaves the phone: the native recognizer streams the microphone and returns text.

import { PermissionsAndroid, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import {
  UNAVAILABLE_VOICE_ENGINE,
  UNSUPPORTED_VOICE,
  VoiceError,
  type VoiceAudio,
  type VoiceCapability,
  type VoiceEngine,
} from '@ramu/shared/voice/engine'
import type { DictationFailure } from '@ramu/shared/voice/dictation'

interface NativeSubscription {
  remove(): void
}

interface RamuSpeechNative {
  capability(language: string): Promise<VoiceCapability>
  downloadModel?(language: string): Promise<void>
  start(language: string, maxMs: number, maxBytes: number): Promise<void>
  stop(): Promise<string>
  cancel(): Promise<void>
  addListener(event: 'onLevel', listener: (event: { level: number }) => void): NativeSubscription
  addListener(event: 'onInterrupt' | 'onLimit', listener: () => void): NativeSubscription
}

const REASONS: DictationFailure[] = ['permission', 'unavailable', 'language', 'model', 'capture', 'recognition']

/** Maps whatever the native call threw to a typed failure; unknown errors count as recognition failures. */
export function nativeFailure(error: unknown): VoiceError {
  if (error instanceof VoiceError) return error
  const text = `${(error as { code?: unknown })?.code ?? ''} ${(error as { message?: unknown })?.message ?? ''}`
  return new VoiceError(REASONS.find((reason) => text.includes(reason)) ?? 'recognition')
}

const nativeModule = (): RamuSpeechNative | null => {
  if (Platform.OS === 'web') return null
  return requireOptionalNativeModule<RamuSpeechNative>('RamuSpeech')
}

let androidPermissionDenied = false

/** Asked from here, not natively, and never again after a denial: the person changes it in system settings. */
async function ensureAndroidMicrophone() {
  if (Platform.OS !== 'android') return
  if (androidPermissionDenied) throw new VoiceError('permission')
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
  if (await PermissionsAndroid.check(permission)) return
  const result = await PermissionsAndroid.request(permission, {
    title: 'Dictate messages',
    message: 'Ramu records only while you dictate, and recognizes speech on this device.',
    buttonPositive: 'Continue',
  })
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    androidPermissionDenied = true
    throw new VoiceError('permission')
  }
}

export function createPhoneVoiceEngine(native: RamuSpeechNative | null = nativeModule()): VoiceEngine {
  if (!native) return UNAVAILABLE_VOICE_ENGINE
  return {
    capture: {
      async start(options) {
        await ensureAndroidMicrophone()
        const subscriptions: NativeSubscription[] = [
          native.addListener('onLevel', (event) => options.onLevel?.(event.level)),
          native.addListener('onInterrupt', () => options.onInterrupt()),
          native.addListener('onLimit', () => options.onLimit?.()),
        ]
        const unsubscribe = () => subscriptions.forEach((subscription) => subscription.remove())
        try {
          await native.start(options.language, options.maxMs, options.maxBytes)
        } catch (error) {
          unsubscribe()
          throw nativeFailure(error)
        }
        let finished = false
        return {
          async stop() {
            try {
              const text = await native.stop()
              const audio: VoiceAudio & { text: string } = { text, dispose: () => Promise.resolve() }
              return audio
            } catch (error) {
              throw nativeFailure(error)
            } finally {
              finished = true
              unsubscribe()
            }
          },
          async cancel() {
            if (!finished) await native.cancel().catch(() => undefined)
            finished = true
            unsubscribe()
          },
        }
      },
    },
    transcriber: {
      async capability(language) {
        try {
          return await native.capability(language)
        } catch {
          return UNSUPPORTED_VOICE
        }
      },
      async prepare(language) {
        // Android can start the system's own model download; iOS models come from system dictation settings.
        if (!native.downloadModel) throw new VoiceError('model')
        try {
          await native.downloadModel(language)
        } catch (error) {
          throw new VoiceError('model', error instanceof Error ? error.message : undefined)
        }
      },
      // Recognition already happened while recording; the text is carried by the audio handle.
      async transcribe(audio) {
        return (audio as VoiceAudio & { text?: string }).text ?? ''
      },
    },
  }
}
