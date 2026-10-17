import { Platform, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronDown, ChevronRight, Monitor, Plus } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { counts, useStore } from '../runtime/store'
import { useT } from '../i18n'
import { ConnectionDot, T, tap } from './ui'
import { openComputerMenu } from './Overlays'

/** The selected computer with its status and live counts; tap to switch computers, pair another or open a terminal. */
export function ComputerSwitcher() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const { computers, chats, selected } = useStore()
  const pc = computers.find((x) => x.id === selected)
  const n = counts(chats, selected)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pc ? t.computers : t.pair}
      onPress={() => {
        tap()
        if (pc) openComputerMenu()
        else router.push('/pair')
      }}
      style={({ pressed }) => ({
        marginHorizontal: space.l,
        marginTop: space.s,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.m,
        padding: space.m,
        borderRadius: radius.m,
        backgroundColor: pressed ? c.raised : c.raised2,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.s + 2,
          backgroundColor: c.fill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Monitor size={17} color={c.soft} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T weight="600" numberOfLines={1}>
            {pc?.name ?? t.pair}
          </T>
          {pc ? <ConnectionDot status={pc.status} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {pc ? pc.address.replace(/^https?:\/\//, '') : t.pairHint}
          </T>
          {n.running ? <T size={font.caption} weight="600" tone="accent">{`· ${n.running} ${t.running}`}</T> : null}
          {n.waiting ? <T size={font.caption} weight="600" tone="warn">{`· ${n.waiting} ${t.waiting}`}</T> : null}
        </View>
      </View>
      {pc ? (
        <ChevronDown size={16} color={c.muted} />
      ) : Platform.OS === 'android' ? (
        <Plus size={20} color={c.accent} />
      ) : (
        <ChevronRight size={16} color={c.muted} />
      )}
    </Pressable>
  )
}
