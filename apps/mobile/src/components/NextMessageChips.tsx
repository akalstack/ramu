import { Pressable, ScrollView } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { T, tap } from './ui'

/**
 * Predicted next messages above an empty message box, drawn like the box's other chips: the same height, fill, inset
 * and spacing. Tapping one puts it in the box to edit or send.
 */
export function NextMessageChips({ messages, onUse }: { messages: string[]; onUse: (message: string) => void }) {
  const { c } = useTheme()
  const say = useSay()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={say('Suggested next messages')}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 6, paddingHorizontal: space.m, paddingTop: space.s }}
    >
      {messages.map((message) => (
        <Pressable
          key={message}
          accessibilityRole="button"
          accessibilityLabel={message}
          accessibilityHint={say('Puts it in the message box')}
          onPress={() => {
            tap()
            onUse(message)
          }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            height: 26,
            paddingHorizontal: 10,
            borderRadius: radius.full,
            backgroundColor: c.fill,
            opacity: pressed ? 0.7 : 1,
            maxWidth: 240,
          })}
        >
          <Sparkles size={12} color={c.accent} />
          <T size={font.caption + 1} weight="500" numberOfLines={1} style={{ flexShrink: 1 }}>
            {message}
          </T>
        </Pressable>
      ))}
    </ScrollView>
  )
}
