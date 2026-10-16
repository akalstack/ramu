import { ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native'
import { Clock, CloudOff, CornerDownRight, ListPlus } from 'lucide-react-native'
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
        ? "It hasn't reached the computer yet, so the thread is discarded."
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
  const { cancelOutbox } = useStore()
  const ModeIcon = item.mode === 'steer' ? CornerDownRight : item.mode === 'queue' ? ListPlus : Clock
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Waiting to send: ${item.text}. Tap to cancel`}
      onPress={() => {
        tap()
        confirmCancel(item, onEdit, cancelOutbox)
      }}
      style={{ alignSelf: 'flex-end', maxWidth: '86%', alignItems: 'flex-end', gap: 4 }}
    >
      <View
        style={{
          backgroundColor: c.bubble,
          opacity: 0.6,
          borderRadius: radius.l - 2,
          borderBottomRightRadius: radius.xs,
          paddingHorizontal: space.m + 2,
          paddingVertical: space.s + 2,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: c.lineStrong,
        }}
      >
        <T style={{ lineHeight: 21 }}>{item.text}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 4 }}>
        <ModeIcon size={12} color={c.muted} />
        <T size={font.caption} tone="muted">
          {item.state === 'uncertain'
            ? 'Check delivery on host'
            : item.state === 'sending'
              ? 'Sending'
              : item.mode === 'steer'
                ? 'Steer'
                : item.mode === 'queue'
                  ? 'Queued'
                  : 'Waiting'}{' '}
          · {item.state === 'uncertain' ? item.error : `sends when ${computer} is back`} ·{' '}
          <T size={font.caption} tone="accent" weight="600">
            Cancel
          </T>
        </T>
      </View>
    </Pressable>
  )
}

/** Thin strip under the header while the chat's computer is unreachable. */
export function OfflineBanner({ computer, pending }: { computer: string; pending: number }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        marginHorizontal: space.l,
        marginBottom: space.xs,
        paddingHorizontal: space.m,
        paddingVertical: space.s,
        borderRadius: radius.m,
        backgroundColor: c.warnWash,
      }}
    >
      <CloudOff size={15} color={c.warn} />
      <T size={font.control} tone="soft" style={{ flex: 1 }} numberOfLines={2}>
        {computer} is offline. {pending ? `${pending} waiting in the outbox; ` : 'Messages wait in the outbox and '}they
        send when it reconnects.
      </T>
    </View>
  )
}
