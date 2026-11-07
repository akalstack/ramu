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
import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { mobileThreadActivity } from '../runtime/threadActivity'

/**
 * The turn's live status. As a pill in the composer's activity row it says what the agent is doing (the running
 * command or file) and for how long, and opens the turn's latest steps and Stop. `inline` is the desktop's status line
 * at the end of the running turn instead.
 */
export function WorkingLine({
  chat,
  sending,
  inline,
  quiet,
  onPress,
}: {
  chat: Chat
  sending?: boolean
  inline?: boolean
  /** Inline only: the newest row already says what the agent is doing, so the line keeps its place but says nothing. */
  quiet?: boolean
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
  // The lead finished its turn but sub-agents it started are still at work: the thread is waiting on them, not done,
  // as T3 Code shows it. Background commands such as a dev server are not waited on; their own pill shows them.
  const waitingOn =
    !running && !sending && online
      ? mobileThreadActivity(chat, online).helpers.filter(
          (task) => helperActive(task) && task.taskType !== 'local_bash' && task.taskType !== 'advisor',
        )
      : []
  if (inline && waitingOn.length)
    return (
      <View accessibilityRole="text" accessibilityLiveRegion="polite" style={{ height: 24, justifyContent: 'center' }}>
        <Shimmer size={font.control} singleLine>
          {waitingOn.length === 1
            ? translate(store.language, 'Waiting on {0}', { 0: waitingOn[0]!.name })
            : translate(store.language, 'Waiting on {0} agents', { 0: String(waitingOn.length) })}
        </Shimmer>
      </View>
    )
  // From the moment a message is sent, so the pill does not wait for the host to report the turn.
  if (!running && !(sending && online)) return null
  const step = chat.compacting
    ? { label: 'Compacting context…' }
    : running
      ? (chat.step ?? { label: 'Working' })
      : { label: 'Sending…' }
  // The desktop's ChatStatus: what the agent is doing, shimmering at the end of the turn, nothing to tap. How long the
  // turn took shows once it folds into "Worked for…".
  if (inline)
    return (
      <View
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        // One height from sending to the turn's end, whatever it says, so the end of the chat never shifts under it.
        style={{ height: 24, justifyContent: 'center' }}
      >
        {quiet ? null : (
          <Shimmer size={font.control} singleLine>
            {t(running ? (chat.compacting ? 'Compacting context…' : (chat.activityLabel ?? 'Working')) : 'Sending…')}
          </Shimmer>
        )}
      </View>
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
