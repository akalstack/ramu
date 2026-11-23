import { View } from 'react-native'
import { Clock } from 'lucide-react-native'
import type { QueuedMessage } from '@ramu/shared/types'
import { visibleMessage } from '@ramu/shared/chat/visibleMessage'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { T, tap } from './ui'

/**
 * A new thread's first message while the host holds it, because another thread is working in the same checkout, as on
 * the desktop: it reads as the opening message rather than leaving the thread empty, with why it waits and a way to
 * that thread. It joins the transcript as a sent message once the other thread is done.
 */
export function QueuedOpening({
  message,
  waitingFor,
  onOpenWaiting,
}: {
  message: QueuedMessage
  /** The title of the thread it waits for; without one it is simply queued. */
  waitingFor?: string
  onOpenWaiting?: () => void
}) {
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
        {/* One run of text, so a long title wraps as a sentence with the link at its end. */}
        <T size={font.caption} tone="muted" style={{ flexShrink: 1, textAlign: 'right' }}>
          {waitingFor ? say('Waiting for “{0}” in the same checkout', { 0: waitingFor }) : say('Queued')}
          {waitingFor && onOpenWaiting ? (
            <>
              {' · '}
              <T
                size={font.caption}
                tone="accent"
                accessibilityRole="button"
                onPress={() => {
                  tap()
                  onOpenWaiting()
                }}
              >
                {say('Open thread')}
              </T>
            </>
          ) : null}
        </T>
      </View>
    </View>
  )
}
