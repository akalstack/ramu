import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createVoiceLease, type VoiceCapability, type VoiceEngine } from '@ramu/shared/voice/engine'
import { createVoiceSession, type VoiceDraft, type VoiceSession, type VoiceSnapshot } from '@ramu/shared/voice/session'
import { micControl, parseVoiceSettings, type MicControl, type VoiceSettings } from '@ramu/shared/voice/settings'
import { deviceStorage } from '../deviceStorage'
import { createDesktopVoiceEngine } from './desktopEngine'

export const VOICE_SETTINGS_KEY = 'voice-settings'

// One microphone per computer: every composer in this window shares the engine and its lease. Main arbitrates windows.
let sharedEngine: VoiceEngine | undefined
const engine = () => (sharedEngine ??= createDesktopVoiceEngine())
const lease = createVoiceLease()

const read = (): VoiceSettings => {
  try {
    const raw = deviceStorage.getItem(VOICE_SETTINGS_KEY)
    return parseVoiceSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return parseVoiceSettings(null)
  }
}

/** Voice choices belong to this computer's input devices: device storage, never host preferences or a paired host. */
export function useVoiceSettings(): [VoiceSettings, (patch: Partial<VoiceSettings>) => void] {
  const [settings, setSettings] = useState(read)
  useEffect(() => deviceStorage.subscribe((key) => key === VOICE_SETTINGS_KEY && setSettings(read())), [])
  const update = useCallback((patch: Partial<VoiceSettings>) => {
    const next = { ...read(), ...patch }
    if (next.inputDeviceId === undefined) delete next.inputDeviceId
    deviceStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(next))
  }, [])
  return [settings, update]
}

/** What the engine can do for the chosen language; read again when the window returns to the foreground. */
export function useVoiceCapability(settings: VoiceSettings): VoiceCapability | undefined {
  const [capability, setCapability] = useState<VoiceCapability>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  useEffect(() => {
    if (!settings.enabled) return setCapability(undefined)
    let current = true
    void engine()
      .transcriber.capability(settings.language)
      .then((next) => current && setCapability(next))
      .catch(() => current && setCapability(undefined))
    return () => {
      current = false
    }
  }, [settings.enabled, settings.language, tick])
  return capability
}

export const useMicControl = (settings: VoiceSettings, capability: VoiceCapability | undefined): MicControl =>
  useMemo(() => micControl(settings, capability), [settings, capability])

export interface Dictation {
  snapshot: VoiceSnapshot
  session: VoiceSession
}

/**
 * Dictation for one composer. `getDraft` is read when the transcript arrives, so the composer only keeps its revision
 * current; a scope change (another draft key) discards a take that is still running and keeps the draft.
 */
export function useDictation(options: {
  draftKey: string
  settings: VoiceSettings
  getDraft: () => VoiceDraft
  onInsert: (result: { text: string; caret: number }) => void
}): Dictation {
  const latest = useRef(options)
  latest.current = options
  const session = useMemo(
    () =>
      createVoiceSession({
        engine: engine(),
        lease,
        getDraft: () => latest.current.getDraft(),
        getLanguage: () => latest.current.settings.language,
        getInputDeviceId: () => latest.current.settings.inputDeviceId,
        onInsert: (result) => latest.current.onInsert(result),
      }),
    [],
  )
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot)
  const { draftKey } = options
  useEffect(() => () => session.interrupt('scope'), [draftKey, session])
  return { snapshot, session }
}
