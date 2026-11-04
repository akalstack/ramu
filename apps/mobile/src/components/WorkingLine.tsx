import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { elapsedText } from '@ramu/shared/chat/agentActivity'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { T, tap } from './ui'
import { Shimmer } from './Motion'

/**
 * The turn's live status: what the agent is doing (the running command or file), and how long the turn has run.
 * Tapping it opens the turn's latest steps and Stop. `inline` draws it as the desktop does, a shimmering line at the end
 * of the running turn in the transcript; otherwise it is a pill in the composer's activity row.
 */
export function WorkingLine({
  chat,
  sending,
  inline,
  onPress,
}: {
  chat: Chat
  sending?: boolean
  inline?: boolean
  onPress?(): void
}) {
  const store = useStore()
  const { c } = useTheme()
  const t = (text: string) => translate(store.language, text)
  const online = store.isOnline(chat.computerId)
  const running = chat.status === 'running' && online
  const since = chat.turnStartedAt ?? null
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running || !since) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, since])
  // From the moment a message is sent, so the pill does not wait for the host to report the turn.
  if (!running && !(sending && online)) return null
  const step = chat.compacting
    ? { label: 'Compacting context…' }
    : running
      ? (chat.step ?? { label: 'Working' })
      : { label: 'Sending…' }
  if (inline)
    return (
      <Pressable
        accessibilityLiveRegion="polite"
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={[t(step.label), step.detail, running && since ? elapsedText(now - since) : null]
          .filter(Boolean)
          .join(', ')}
        disabled={!onPress}
        hitSlop={6}
        onPress={() => {
          tap()
          onPress?.()
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: space.s,
          minHeight: 28,
          maxWidth: '100%',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Shimmer size={font.control} singleLine>
          {t(step.label)}
        </Shimmer>
        {step.detail ? (
          <T size={font.caption} tone="muted" mono numberOfLines={1} style={{ flexShrink: 1 }}>
            {step.detail}
          </T>
        ) : null}
        {running && since ? (
          <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
            {elapsedText(now - since)}
          </T>
        ) : null}
        {onPress ? <ChevronRight size={12} color={c.muted} /> : null}
      </Pressable>
    )
  return (
    <Pressable
      accessibilityLiveRegion="polite"
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[t(step.label), step.detail, since ? elapsedText(now - since) : null]
        .filter(Boolean)
        .join(', ')}
      disabled={!onPress}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        minHeight: 32,
        paddingHorizontal: space.s + 2,
        borderRadius: radius.full,
        backgroundColor: c.fill,
        flexShrink: 0,
        maxWidth: 320,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} />
      <T size={font.caption} weight="500">
        {t(step.label)}
      </T>
      {step.detail ? (
        <T size={font.caption} mono numberOfLines={1} style={{ flexShrink: 1 }}>
          {step.detail}
        </T>
      ) : null}
      {running && since ? (
        <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {elapsedText(now - since)}
        </T>
      ) : null}
      {onPress ? <ChevronRight size={12} color={c.muted} /> : null}
    </Pressable>
  )
}
