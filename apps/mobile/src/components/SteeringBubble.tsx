import { View } from 'react-native'
import { Pencil, Trash2 } from 'lucide-react-native'
import type { QueuedMessage } from '@ramu/shared/types'
import { visibleMessage } from '@ramu/shared/chat/visibleMessage'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { IconButton, T } from './ui'

/**
 * A steer waiting for the running turn, shown after the latest tool call like the desktop. It becomes a sent message
 * once the turn takes it. Editing opens it in the message box and holds it on the host until the edit is saved or
 * cancelled; a saved edit goes out as a new steer.
 */
export function SteeringBubble({
  chatId,
  message,
  readOnly,
  editing,
  onEdit,
}: {
  chatId: string
  message: QueuedMessage
  readOnly: boolean
  /** Open in the message box, held on the host until it is saved or cancelled. */
  editing: boolean
  onEdit: () => void
}) {
  const { c } = useTheme()
  const say = useSay()
  const { removeQueued } = useStore()
  const text = visibleMessage(message.text)
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '86%', alignItems: 'flex-end', gap: 4 }}>
      <View
        accessibilityLabel={`${say('Steer')}: ${text}`}
        style={{
          backgroundColor: c.bubble,
          borderRadius: radius.l - 2,
          borderBottomRightRadius: radius.xs,
          paddingHorizontal: space.m + 2,
          paddingVertical: space.s + 2,
        }}
      >
        <T style={{ lineHeight: 21 }}>{text}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 2 }}>
        <T size={font.caption} tone={editing ? 'accent' : 'muted'}>
          {editing
            ? say('Editing in the message box')
            : message.held
              ? say('Held while editing')
              : say('Steering · sends after the current tool call')}
        </T>
        {readOnly || editing ? null : (
          <>
            <IconButton icon={Pencil} label={say('Edit steering message')} size={28} tone="muted" onPress={onEdit} />
            <IconButton
              icon={Trash2}
              label={say('Remove steering message')}
              size={28}
              tone="muted"
              onPress={() => removeQueued(chatId, message.id)}
            />
          </>
        )}
      </View>
    </View>
  )
}
