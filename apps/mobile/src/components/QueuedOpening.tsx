import { View } from 'react-native'
import { Clock } from 'lucide-react-native'
import type { QueuedMessage } from '@ramu/shared/types'
import { visibleMessage } from '@ramu/shared/chat/visibleMessage'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { T } from './ui'

/**
 * A new thread's first message while the host holds it, such as during an undo or other rewrite of its checkout, as on
 * the desktop: it reads as the opening message rather than leaving the thread empty. It joins the transcript as a sent
 * message once the host sends it.
 */
export function QueuedOpening({ message }: { message: QueuedMessage }) {
  const { c } = useTheme()
  const say = useSay()
  const text = visibleMessage(message.text)
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '86%', alignItems: 'flex-end', gap: 4 }}>
      {text ? (
        <View
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
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingRight: 2 }}>
        <Clock size={12} color={c.muted} style={{ marginTop: 3 }} />
        <T size={font.caption} tone="muted" style={{ flexShrink: 1, textAlign: 'right' }}>
          {say('Queued')}
        </T>
      </View>
    </View>
  )
}
