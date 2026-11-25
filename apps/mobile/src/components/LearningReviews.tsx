import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import type { LearningJob } from '@ramu/shared/types'
import { learningLine } from '@ramu/shared/learningReviews'
import { font, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { useAutomation } from '../runtime/automation'
import { learningCounts, learningLineText, undoneText } from '../runtime/learningLines'
import type { TranscriptItem } from '../runtime/types'
import { ago, useSay } from '../i18n'
import { showError, showToast } from '../runtime/toast'
import { useOpenThread } from './paneContext'
import { Divider, ROW_INSET, Row, T, tap } from './ui'

type Action = 'apply' | 'dismiss' | 'undo'

/** Apply, Dismiss and Undo for one host's reviews: one at a time, and only where the host can take them. */
function useLearningActions(computerId: string) {
  const store = useStore()
  const auto = useAutomation()
  const say = useSay()
  const [busy, setBusy] = useState(false)
  const viewer = store.computers.find((computer) => computer.id === computerId)?.access === 'viewer'
  const disabled = busy || viewer || !store.isOnline(computerId)
  const act = (action: Action, jobId: string) => {
    if (disabled) return
    tap()
    setBusy(true)
    void auto
      .actLearning(computerId, action, jobId)
      .then((kept) => (action === 'undo' ? showToast(undoneText(kept, say)) : undefined))
      .catch(showError)
      .finally(() => setBusy(false))
  }
  const button = (action: Action, jobId: string) => (
    <Pressable
      key={action}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={() => act(action, jobId)}
    >
      <T size={font.caption} weight="600" tone={disabled ? 'muted' : action === 'apply' ? 'accent' : 'soft'}>
        {action === 'apply' ? say('Apply') : action === 'dismiss' ? say('Dismiss') : say('Undo')}
      </T>
    </Pressable>
  )
  return button
}

/**
 * One review waiting in Inbox → Learned: the thread it learned from, what it would save, Apply and Dismiss. The row
 * opens the thread; its actions sit beside it rather than inside it.
 */
export function WaitingReviewRow({
  computerId,
  job,
  host,
  divider,
}: {
  computerId: string
  job: LearningJob
  /** The host's name, when more than one is paired. */
  host?: string
  divider: boolean
}) {
  const { c } = useTheme()
  const say = useSay()
  const store = useStore()
  const openThread = useOpenThread()
  const button = useLearningActions(computerId)
  const line = learningLine(job)
  if (!line) return null
  const chat = store.chats.find((entry) => entry.computerId === computerId && entry.sessionId === job.sessionId)
  return (
    <View>
      {divider ? <Divider inset={ROW_INSET} /> : null}
      <Row
        accessibilityLabel={chat ? say('Open thread') : undefined}
        disabled={!chat}
        onPress={
          chat
            ? () => {
                tap()
                openThread(chat.id)
              }
            : undefined
        }
        style={{ paddingTop: 11, paddingBottom: space.xs }}
      >
        <Sparkles size={16} color={c.accent} />
        <View style={{ flex: 1 }}>
          <T weight="500" numberOfLines={1}>
            {job.sessionTitle ?? chat?.title ?? say('Thread')}
          </T>
          <T size={font.caption} tone="muted" numberOfLines={2}>
            {[learningCounts(line.waiting, say), host, ago(job.createdAt)].filter(Boolean).join(' · ')}
          </T>
        </View>
      </Row>
      <View style={{ flexDirection: 'row', gap: space.l, paddingLeft: ROW_INSET, paddingBottom: 11 }}>
        {button('apply', job.id)}
        {button('dismiss', job.id)}
      </View>
    </View>
  )
}

/** The quiet line under a turn a review learned from: what it saved or would save, and what can be done about it. */
export function LearningTurnLine({
  item,
  computerId,
}: {
  item: Extract<TranscriptItem, { kind: 'learning' }>
  computerId: string
}) {
  const { c } = useTheme()
  const say = useSay()
  const button = useLearningActions(computerId)
  const { line, jobId } = item
  const actions: Action[] = line.state === 'saved' ? ['undo'] : line.state === 'proposed' ? ['apply', 'dismiss'] : []
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, marginVertical: space.s }}>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.lineStrong }} />
      <View style={{ maxWidth: '78%', alignItems: 'center', gap: 2 }}>
        <View accessible accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Sparkles size={12} color={c.muted} />
          <T size={font.caption} tone={line.state === 'undone' ? 'placeholder' : 'muted'} style={{ flexShrink: 1 }}>
            {learningLineText(line, say)}
          </T>
        </View>
        {actions.length ? (
          <View style={{ flexDirection: 'row', gap: space.l, marginTop: 2 }}>
            {actions.map((action) => button(action, jobId))}
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.lineStrong }} />
    </View>
  )
}
