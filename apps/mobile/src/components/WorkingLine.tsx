import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { elapsedText } from '@ramu/shared/chat/agentActivity'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { Shimmer } from './Motion'
import { T } from './ui'

/**
 * The turn's live status, docked above the composer so it never scrolls away: what the agent is doing (the running
 * command or file), and how long the turn has run.
 */
export function WorkingLine({ chat }: { chat: Chat }) {
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
  if (!running) return null
  const step = chat.compacting ? { label: 'Compacting context…' } : (chat.step ?? { label: 'Working' })
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        minHeight: 32,
        paddingHorizontal: space.s + 2,
        borderRadius: radius.full,
        backgroundColor: c.fill,
        flexShrink: 0,
        maxWidth: 320,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} />
      <Shimmer size={font.caption} singleLine>
        {t(step.label)}
      </Shimmer>
      {step.detail ? (
        <T size={font.caption} mono numberOfLines={1} style={{ flexShrink: 1 }}>
          {step.detail}
        </T>
      ) : null}
      {since ? (
        <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {elapsedText(now - since)}
        </T>
      ) : null}
    </View>
  )
}
