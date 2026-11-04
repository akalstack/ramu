import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { elapsedText } from '@ramu/shared/chat/agentActivity'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { T, tap } from './ui'

/**
 * The turn's live status, docked above the composer so it never scrolls away: what the agent is doing (the running
 * command or file), and how long the turn has run. Tapping it opens the turn's latest steps and Stop.
 */
export function WorkingLine({ chat, sending, onPress }: { chat: Chat; sending?: boolean; onPress?(): void }) {
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
        // Floating over the transcript, so it needs an opaque surface rather than the row's translucent fill.
        backgroundColor: c.raised,
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
