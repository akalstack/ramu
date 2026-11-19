import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Check, Mic, X } from 'lucide-react-native'
import {
  DICTATION_MAX_MS,
  VOICE_WAVE_SILENT,
  VOICE_WAVE_TICK_MS,
  nextVoiceWave,
  type DictationFailure,
  type DictationState,
} from '@ramu/shared/voice/dictation'
import { formatElapsed } from '@ramu/shared/voice/settings'
import { fill, useT, type Strings } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { useReducedMotion } from './Motion'
import { T, tap } from './ui'

export const failureText = (t: Strings, reason: DictationFailure): string =>
  ({
    permission: t.dictateFailedPermission,
    unavailable: t.dictateFailedUnavailable,
    language: t.dictateFailedLanguage,
    model: t.dictateFailedModel,
    capture: t.dictateFailedCapture,
    recognition: t.dictateFailedRecognition,
    empty: t.dictateFailedEmpty,
    interrupted: t.dictateFailedInterrupted,
  })[reason]

function ActionPill({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        tap()
        onPress()
      }}
      style={{
        height: 32,
        paddingHorizontal: space.m,
        borderRadius: radius.full,
        justifyContent: 'center',
        backgroundColor: strong ? c.primary : c.fill,
      }}
    >
      <T size={font.control} weight="500" style={{ color: strong ? c.primaryInk : c.text }}>
        {label}
      </T>
    </Pressable>
  )
}

function IconAction({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) {
  const { c } = useTheme()
  const Icon = strong ? Check : X
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        tap()
        onPress()
      }}
      style={{
        width: 34,
        height: 34,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: strong ? c.primary : c.fill,
      }}
    >
      <Icon size={17} color={strong ? c.primaryInk : c.soft} strokeWidth={2.2} />
    </Pressable>
  )
}

/** Recent microphone level, not recognition progress. Reduced motion leaves the level on the dot alone. */
function VoiceWave({ level }: { level: number }) {
  const { c } = useTheme()
  const reduced = useReducedMotion()
  const latest = useRef(level)
  latest.current = level
  const [wave, setWave] = useState(VOICE_WAVE_SILENT)
  useEffect(() => {
    if (reduced) return
    const timer = setInterval(() => setWave((bars) => nextVoiceWave(bars, latest.current)), VOICE_WAVE_TICK_MS)
    return () => clearInterval(timer)
  }, [reduced])
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flex: 1, height: 16, flexDirection: 'row', alignItems: 'center', gap: 2, overflow: 'hidden' }}
    >
      {reduced
        ? null
        : wave.map((bar, index) => (
            <View
              key={index}
              style={{
                width: 2,
                height: `${Math.max(12, bar * 100)}%`,
                borderRadius: radius.full,
                backgroundColor: c.soft,
              }}
            />
          ))}
    </View>
  )
}

/** Elapsed recording time, ticking once a second without re-rendering the whole composer. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  return <>{formatElapsed(Math.min(now - since, DICTATION_MAX_MS))}</>
}

/**
 * Status above the message box while a take is active or has something to say. A running take is one flat line of the
 * composer, with Cancel and the only primary control together on the right; review and failures are shaded notices.
 */
export function DictationStatus({
  state,
  level,
  onStop,
  onCancel,
  onInsert,
  onDismiss,
  showSettings,
}: {
  state: DictationState
  level: number
  onStop: () => void
  onCancel: () => void
  /** Review only: insert the held transcript at the current cursor. */
  onInsert: () => void
  onDismiss: () => void
  /** Offers the system settings action on a permission failure. */
  showSettings?: boolean
}) {
  const { c } = useTheme()
  const t = useT()
  if (state.phase === 'idle') return null
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.s,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.m,
    backgroundColor: c.fill,
    marginTop: space.s,
  }
  const line = { ...row, paddingHorizontal: 0, paddingVertical: 0, minHeight: 34, backgroundColor: 'transparent' }
  if (state.phase === 'preparing' || state.phase === 'transcribing') {
    return (
      <View
        style={line}
        accessibilityRole="progressbar"
        accessibilityLabel={state.phase === 'preparing' ? t.dictatePreparing : t.dictateTranscribing}
      >
        <ActivityIndicator size="small" color={c.soft} />
        <T size={font.control} tone="soft" style={{ flex: 1 }}>
          {state.phase === 'preparing' ? t.dictatePreparing : t.dictateTranscribing}
        </T>
        {state.phase === 'transcribing' ? <IconAction label={t.dictateDiscard} onPress={onCancel} /> : null}
      </View>
    )
  }
  if (state.phase === 'recording' || state.phase === 'limit') {
    const limit = state.phase === 'limit'
    return (
      <View style={line}>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: radius.full,
            backgroundColor: limit ? c.warn : c.bad,
            opacity: limit ? 1 : 0.6 + level * 0.4,
          }}
        />
        <T
          size={font.control}
          tone={limit ? 'warn' : 'soft'}
          style={limit ? { flex: 1 } : { fontVariant: ['tabular-nums'] }}
        >
          {limit ? (
            t.dictateLimit
          ) : (
            <>
              {fill(t.dictateRecording, '')}
              <Elapsed since={state.startedAt} />
            </>
          )}
        </T>
        {limit ? null : <VoiceWave level={level} />}
        <IconAction label={limit ? t.dictateDiscard : t.dictateCancel} onPress={onCancel} />
        <IconAction label={limit ? t.dictateTranscribe : t.dictateStop} onPress={onStop} strong />
      </View>
    )
  }
  if (state.phase === 'review') {
    return (
      <View style={[row, { flexDirection: 'column', alignItems: 'stretch' }]}>
        <T size={font.control} weight="500">
          {t.dictateReady}
        </T>
        <T size={font.caption} tone="soft">
          {t.dictateReadyHint}
        </T>
        <T size={font.control} numberOfLines={3}>
          {state.text}
        </T>
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <ActionPill label={t.dictateInsert} onPress={onInsert} strong />
          <ActionPill label={t.dictateCopy} onPress={() => void Clipboard.setStringAsync(state.text)} />
          <ActionPill label={t.dictateDiscard} onPress={onDismiss} />
        </View>
      </View>
    )
  }
  return (
    <View style={row} accessibilityRole="alert">
      <T size={font.control} tone="soft" style={{ flex: 1 }}>
        {failureText(t, state.reason)}
      </T>
      {showSettings && state.reason === 'permission' ? (
        <ActionPill label={t.dictateOpenSettings} onPress={() => void Linking.openSettings()} />
      ) : null}
      <ActionPill label={t.dictateDiscard} onPress={onDismiss} />
    </View>
  )
}

/** The microphone in the action row: one tap starts, and while a take runs it shows as active. */
export function MicButton({ active, disabled, onPress }: { active: boolean; disabled?: boolean; onPress: () => void }) {
  const { c } = useTheme()
  const t = useT()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.dictate}
      accessibilityState={{ disabled: !!disabled, selected: active }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        tap()
        onPress()
      }}
      style={{
        width: 34,
        height: 34,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? c.fill : 'transparent',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Mic size={18} color={active ? c.bad : c.soft} strokeWidth={1.8} />
    </Pressable>
  )
}
