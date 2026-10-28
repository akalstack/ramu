import { VIEW_ONLY_WRITE_NOTICE } from '../runtime/viewerAccess'
import { useState } from 'react'
import { useT } from '../i18n'
import { WorktreeBaseReview } from './WorktreeBaseReview'
import { ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native'
import { Clock, CornerDownRight, ListPlus } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore, type OutboxItem } from '../runtime/store'
import { T, tap } from './ui'

/** Asks how to cancel an outbox item: edit puts the text back in the composer, delete drops it. */
export function confirmCancel(
  item: OutboxItem,
  onEdit?: (text: string) => void,
  cancel?: (id: string) => string | undefined,
) {
  const first = item.kind === 'chat'
  const title = first ? 'Cancel this new thread?' : 'Cancel this message?'
  const message =
    item.state === 'uncertain'
      ? 'Delivery is uncertain. Check the host conversation before sending again. Removing this entry does not undo an action the host already received.'
      : first
        ? "It hasn't reached the host yet, so the thread is discarded."
        : "It hasn't been sent yet."
  const remove = () => cancel?.(item.id)
  const edit = () => {
    const text = cancel?.(item.id)
    if (text != null) onEdit?.(text)
  }
  const options = onEdit && !first ? ['Edit message', 'Delete', 'Keep'] : ['Delete', 'Keep']
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options,
        destructiveButtonIndex: options.indexOf('Delete'),
        cancelButtonIndex: options.length - 1,
      },
      (i) => {
        if (options[i] === 'Delete') remove()
        else if (options[i] === 'Edit message') edit()
      },
    )
  } else {
    Alert.alert(title, message, [
      { text: 'Keep', style: 'cancel' },
      ...(onEdit && !first ? [{ text: 'Edit', onPress: edit }] : []),
      { text: 'Delete', style: 'destructive' as const, onPress: remove },
    ])
  }
}

/** A message that is still on the phone: a dimmed bubble with its outbox state. Tap to cancel or edit. */
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
  const [reviewing, setReviewing] = useState(false)
  const ModeIcon = item.mode === 'steer' ? CornerDownRight : item.mode === 'queue' ? ListPlus : Clock
  return (
    <>
      <Pressable
        disabled={delivering}
        accessibilityRole={delivering ? 'text' : 'button'}
        accessibilityLabel={delivering ? `Sending: ${item.text}` : `Waiting to send: ${item.text}. Tap to cancel`}
        onPress={() => {
          tap()
          confirmCancel(item, onEdit, cancelOutbox)
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
            borderWidth: 1,
            borderStyle: delivering ? 'solid' : 'dashed',
            borderColor: c.lineStrong,
          }}
        >
          <T style={{ lineHeight: 21 }}>{item.text}</T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 4 }}>
          <ModeIcon size={12} color={c.muted} />
          <T size={font.caption} tone="muted">
            {delivering ? (
              store.language === 'id' ? (
                item.state === 'accepted' ? (
                  'Terkirim'
                ) : (
                  'Mengirim…'
                )
              ) : item.state === 'accepted' ? (
                'Sent'
              ) : (
                'Sending…'
              )
            ) : (
              <>
                {item.state === 'review'
                  ? t.branchReviewBases
                  : item.state === 'uncertain'
                    ? 'Check delivery on host'
                    : item.state === 'sending'
                      ? 'Sending'
                      : item.mode === 'steer'
                        ? 'Steer'
                        : item.mode === 'queue'
                          ? 'Queued'
                          : 'Waiting'}{' '}
                ·{' '}
                {viewOnly
                  ? VIEW_ONLY_WRITE_NOTICE[store.language]
                  : item.state === 'uncertain' || item.state === 'review'
                    ? item.error
                    : `sends when ${computer} is back`}{' '}
                ·{' '}
                <T size={font.caption} tone="accent" weight="600">
                  Cancel
                </T>
              </>
            )}
          </T>
        </View>
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
