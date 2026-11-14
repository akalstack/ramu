import { VIEW_ONLY_WRITE_NOTICE } from '../runtime/viewerAccess'
import { useState } from 'react'
import { useSay, useT } from '../i18n'
import { WorktreeBaseReview } from './WorktreeBaseReview'
import { ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native'
import { Clock, CornerDownRight, ListPlus } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore, type OutboxItem } from '../runtime/store'
import { T, tap } from './ui'
import { LongMessage } from './Transcript'

/** Asks how to cancel an outbox item: edit puts the text back in the composer, delete drops it. */
export function confirmCancel(
  item: OutboxItem,
  onEdit: ((text: string) => void) | undefined,
  cancel: ((id: string) => string | undefined) | undefined,
  say: (text: string) => string,
) {
  const first = item.kind === 'chat'
  const title = say(first ? 'Cancel this new thread?' : 'Cancel this message?')
  const message = say(
    item.state === 'uncertain'
      ? 'Delivery is uncertain. Check the host conversation before sending again. Removing this entry does not undo an action the host already received.'
      : first
        ? "It hasn't reached the host yet, so the thread is discarded."
        : "It hasn't been sent yet.",
  )
  const remove = () => cancel?.(item.id)
  const edit = () => {
    const text = cancel?.(item.id)
    if (text != null) onEdit?.(text)
  }
  const actions = [
    ...(onEdit && !first ? [{ label: say('Edit message'), run: edit }] : []),
    { label: say('Delete'), run: remove },
  ]
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: [...actions.map((action) => action.label), say('Keep')],
        destructiveButtonIndex: actions.length - 1,
        cancelButtonIndex: actions.length,
      },
      (i) => actions[i]?.run(),
    )
  } else {
    Alert.alert(title, message, [
      { text: say('Keep'), style: 'cancel' },
      ...actions.map((action) => ({
        text: action.label,
        onPress: action.run,
        ...(action.run === remove ? { style: 'destructive' as const } : {}),
      })),
    ])
  }
}

/** A normal send shows nothing beyond its bubble; a mark appears only if the host is taking this long to answer. */
/**
 * A message that is still on the phone. On its way it looks like the sent message that will replace it, as on the
 * desktop, and the words stay for what needs the person: it is held for a host, or its delivery is in doubt.
 */
export function PendingBubble({
  item,
  computer,
  onEdit,
}: {
  item: OutboxItem
  computer: string
  onEdit: (text: string) => void
}) {
  const { c } = useTheme()
  const store = useStore()
  const { cancelOutbox } = store
  const viewOnly = store.computers?.find((host) => host.id === item.computerId)?.access === 'viewer'
  const delivering =
    item.state === 'accepted' ||
    (!viewOnly && store.isOnline(item.computerId) && (item.state === 'sending' || item.state === 'waiting'))
  const t = useT()
  const say = useSay()
  const [reviewing, setReviewing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const ModeIcon = item.mode === 'steer' ? CornerDownRight : item.mode === 'queue' ? ListPlus : Clock
  return (
    <>
      <Pressable
        disabled={delivering}
        accessibilityRole={delivering ? 'text' : 'button'}
        accessibilityLabel={
          delivering
            ? say('Sending: {0}', { 0: item.text })
            : say('Waiting to send: {0}. Tap to cancel', { 0: item.text })
        }
        onPress={() => {
          tap()
          confirmCancel(item, onEdit, cancelOutbox, say)
        }}
        style={{ alignSelf: 'flex-end', maxWidth: '86%', alignItems: 'flex-end', gap: 4 }}
      >
        <View
          style={{
            backgroundColor: c.bubble,
            opacity: delivering ? 1 : 0.6,
            borderRadius: radius.l - 2,
            borderBottomRightRadius: radius.xs,
            paddingHorizontal: space.m + 2,
            paddingVertical: space.s + 2,
            ...(delivering ? {} : { borderWidth: 1, borderStyle: 'dashed' as const, borderColor: c.lineStrong }),
          }}
        >
          {/* Drawn as the sent message will be (Markdown, long ones cut to a preview), so the swap does not move the
              transcript; the floating pill above the composer says it is sending. */}
          {delivering ? (
            <LongMessage
              text={item.text}
              expanded={expanded}
              label={say(expanded ? 'Show less' : 'Show more')}
              accent={c.accent}
              onToggle={() => setExpanded((open) => !open)}
            />
          ) : (
            <T style={{ lineHeight: 21 }}>{item.text}</T>
          )}
        </View>
        {delivering ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 4 }}>
            <ModeIcon size={12} color={c.muted} />
            <T size={font.caption} tone="muted">
              {item.state === 'review'
                ? t.branchReviewBases
                : say(
                    item.state === 'uncertain'
                      ? 'Check delivery on host'
                      : item.state === 'sending'
                        ? 'Sending'
                        : item.mode === 'steer'
                          ? 'Steer'
                          : item.mode === 'queue'
                            ? 'Queued'
                            : 'Waiting',
                  )}{' '}
              ·{' '}
              {viewOnly
                ? VIEW_ONLY_WRITE_NOTICE[store.language]
                : item.state === 'uncertain' || item.state === 'review'
                  ? item.error
                  : say('sends when {0} is back', { 0: computer })}{' '}
              ·{' '}
              <T size={font.caption} tone="accent" weight="600">
                {say('Cancel')}
              </T>
            </T>
          </View>
        )}
      </Pressable>
      {!viewOnly && item.state === 'review' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.branchReviewBases}
          onPress={() => setReviewing(true)}
        >
          <T tone="accent">{t.branchReviewBases}</T>
        </Pressable>
      ) : null}
      {!viewOnly && reviewing && item.state === 'review' ? (
        <WorktreeBaseReview item={item} onClose={() => setReviewing(false)} />
      ) : null}
    </>
  )
}

/** Thin strip under the header while the chat's computer is unreachable. */
