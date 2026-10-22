import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { createVoiceLease, type VoiceCapability, type VoiceEngine } from '@ramu/shared/voice/engine'
import { createVoiceSession, type VoiceDraft, type VoiceSession, type VoiceSnapshot } from '@ramu/shared/voice/session'
import { micControl, parseVoiceSettings, type MicControl, type VoiceSettings } from '@ramu/shared/voice/settings'
import { createPhoneVoiceEngine } from './voiceEngine'
import { useStore } from './store'

// One microphone per phone: every composer shares the engine and its lease.
let sharedEngine: VoiceEngine | undefined
const engine = () => (sharedEngine ??= createPhoneVoiceEngine())
const lease = createVoiceLease()

/** Downloads a missing speech model on the phone (an explicit action); resolves when it is installed. */
export const prepareVoiceModel = (language: string, signal: AbortSignal, onProgress?: (progress: number) => void) =>
  engine().transcriber.prepare(language, { signal, onProgress })

const SETTINGS_KEY = 'voice-settings'

/** Device-local voice choices, kept with the phone's other local preferences and never sent to a host. */
export function useVoiceSettings(): [VoiceSettings, (patch: Partial<VoiceSettings>) => void] {
  const { drafts, setDraft } = useStore()
  const stored = drafts[SETTINGS_KEY]
  const settings = useMemo(() => {
    try {
      return parseVoiceSettings(stored ? JSON.parse(stored) : null)
    } catch {
      return parseVoiceSettings(null)
    }
  }, [stored])
  const update = useCallback(
    (patch: Partial<VoiceSettings>) => setDraft(SETTINGS_KEY, JSON.stringify({ ...settings, ...patch })),
    [settings, setDraft],
  )
  return [settings, update]
}

/** What the engine can do for the chosen language. Re-read when the app returns to the foreground (permission or model changed in system settings). */
export function useVoiceCapability(settings: VoiceSettings, refreshKey?: unknown): VoiceCapability | undefined {
  const [capability, setCapability] = useState<VoiceCapability>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && setTick((n) => n + 1))
    return () => subscription.remove()
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
  }, [settings.enabled, settings.language, tick, refreshKey])
  return capability
}

export function useMicControl(settings: VoiceSettings, capability: VoiceCapability | undefined): MicControl {
  return useMemo(() => micControl(settings, capability), [settings, capability])
}

export interface Dictation {
  snapshot: VoiceSnapshot
  session: VoiceSession
}

/**
 * Dictation for one composer. `getDraft` is read when the transcript arrives, so the composer only has to keep its
 * revision current; a scope change (another draft key) discards a take that is still running.
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
        onInsert: (result) => latest.current.onInsert(result),
      }),
    [],
  )
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot)
  const { draftKey } = options
  useEffect(
    () => () => session.interrupt('scope'),
    // The take belongs to this draft; another thread or host (or leaving the screen) discards it and keeps the draft.
    [draftKey, session],
  )
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (state) => state !== 'active' && session.interrupt('system'),
    )
    return () => subscription.remove()
  }, [session])
  return { snapshot, session }
}
