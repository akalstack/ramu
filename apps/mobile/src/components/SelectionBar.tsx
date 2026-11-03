import * as Clipboard from 'expo-clipboard'
import { Copy, Ellipsis, MessageCircle, Quote, SquarePen, X, type LucideIcon } from 'lucide-react-native'
import { useContext } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { MessageMenu, type MessageSelection } from './Transcript'
import { T, tap } from './ui'

/** What selected thread text can do: the desktop's split button, sitting where a thumb already is. */
export function SelectionBar({ selection }: { selection: MessageSelection }) {
  const { c } = useTheme()
  const say = useSay()
  const menu = useContext(MessageMenu)
  if (!menu) return null
  const { text, from, more, done } = selection
  const act = (run: () => void) => () => {
    tap()
    run()
    done()
  }
  const Action = ({ icon: Icon, label, run }: { icon: LucideIcon; label: string; run(): void }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={act(run)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.m, minHeight: 40 }}
    >
      <Icon size={15} color={c.body} />
      <T size={font.control} weight="500">
        {label}
      </T>
    </Pressable>
  )
  return (
    <View
      accessibilityRole="toolbar"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: space.m,
        marginBottom: space.s,
        borderRadius: radius.m,
        backgroundColor: c.bubble,
      }}
    >
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
        <Action icon={Quote} label={say('Quote')} run={() => menu.quote(text)} />
        <Action icon={SquarePen} label={say('New thread')} run={() => menu.quoteNew(text)} />
        {menu.readOnly ? null : (
          <Action icon={MessageCircle} label={say('Ask aside')} run={() => menu.aside(text, from)} />
        )}
        <Action icon={Copy} label={say('Copy')} run={() => void Clipboard.setStringAsync(text)} />
      </ScrollView>
      {/* Pinned beside Close, so the whole message's actions (Edit from here among them) never scroll out of reach. */}
      <IconAction icon={Ellipsis} label={say('More')} color={c.body} run={act(more)} />
      <IconAction icon={X} label={say('Close')} color={c.muted} run={act(() => {})} />
    </View>
  )
}

function IconAction({
  icon: Icon,
  label,
  color,
  run,
}: {
  icon: LucideIcon
  label: string
  color: string
  run(): void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={run}
      style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon size={15} color={color} />
    </Pressable>
  )
}
