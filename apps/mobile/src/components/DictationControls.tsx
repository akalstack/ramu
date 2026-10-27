import { useEffect, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Mic } from 'lucide-react-native'
import { DICTATION_MAX_MS, type DictationFailure, type DictationState } from '@ramu/shared/voice/dictation'
import { formatElapsed } from '@ramu/shared/voice/settings'
import { fill, useT, type Strings } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
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
 * Status strip above the message box while a take is active or has something to say. Cancel stays one tap away and
 * the activity dot follows the microphone level, not recognition progress.
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
  if (state.phase === 'preparing' || state.phase === 'transcribing') {
    return (
      <View style={row} accessibilityRole="progressbar" accessibilityLabel={t.dictatePreparing}>
        <T size={font.control} tone="soft" style={{ flex: 1 }}>
          {state.phase === 'preparing' ? t.dictatePreparing : t.dictateTranscribing}
        </T>
        {state.phase === 'transcribing' ? <ActionPill label={t.dictateDiscard} onPress={onCancel} /> : null}
      </View>
    )
  }
  if (state.phase === 'recording' || state.phase === 'limit') {
    const limit = state.phase === 'limit'
    return (
      <View style={row} accessibilityLiveRegion="polite">
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: radius.full,
            backgroundColor: limit ? c.warn : c.bad,
            opacity: limit ? 1 : 0.45 + level * 0.55,
          }}
        />
        <T size={font.control} tone={limit ? 'warn' : 'soft'} style={{ flex: 1 }}>
          {limit ? (
            t.dictateLimit
          ) : (
            <>
              {fill(t.dictateRecording, '')}
              <Elapsed since={state.startedAt} />
            </>
          )}
        </T>
        <ActionPill label={limit ? t.dictateDiscard : t.dictateCancel} onPress={onCancel} />
        <ActionPill label={limit ? t.dictateTranscribe : t.dictateStop} onPress={onStop} strong />
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
