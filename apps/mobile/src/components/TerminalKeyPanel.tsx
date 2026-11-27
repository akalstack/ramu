import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RotateCcw } from 'lucide-react-native'
import { font, space, useTheme } from '../theme'
import { DEFAULT_RAIL, terminalKeyGroups, toggleRailKey } from '../runtime/terminalKeys'
import { useSay } from '../i18n'
import { T } from './ui'

/**
 * Every terminal key, in the space the keyboard had, so switching between the two never moves the terminal. A press
 * sends the key; a long press adds it to or takes it off the rail above the keyboard. The terminal's own gestures stay
 * on the terminal, so scrolling these keys never scrolls or selects there.
 */
export function TerminalKeyPanel({
  height,
  rail,
  disabled,
  onPress,
  onRail,
}: {
  height: number
  rail: string[]
  disabled: boolean
  onPress(label: string): void
  onRail(next: string[]): void
}) {
  const say = useSay()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={{ height, backgroundColor: c.raised, borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
      <ScrollView
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ padding: space.m, paddingBottom: Math.max(insets.bottom, space.m), gap: space.m }}
      >
        {terminalKeyGroups.map((group) => (
          <View key={group.title} style={{ gap: space.xs }}>
            <T size={font.caption} tone="muted">
              {say(group.title)}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {group.keys.map((label) => (
                <Pressable
                  key={label}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint={
                    rail.includes(label)
                      ? say('On the key rail. Long press to remove it.')
                      : say('Long press to add it to the key rail.')
                  }
                  accessibilityState={{ selected: rail.includes(label), disabled }}
                  onPress={() => onPress(label)}
                  onLongPress={() => onRail(toggleRailKey(rail, label))}
                  style={({ pressed }) => ({
                    opacity: disabled ? 0.4 : 1,
                    minWidth: 52,
                    height: 44,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed ? c.pressed : rail.includes(label) ? c.accentWash : c.fill,
                  })}
                >
                  <T mono size={font.control}>
                    {label}
                  </T>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {rail.join() !== DEFAULT_RAIL.join() ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onRail([...DEFAULT_RAIL])}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              alignSelf: 'flex-start',
              paddingVertical: space.s,
              paddingHorizontal: space.m,
              borderRadius: 12,
              backgroundColor: pressed ? c.pressed : c.fill,
            })}
          >
            <RotateCcw size={15} color={c.soft} />
            <T size={font.control}>{say('Reset key rail')}</T>
          </Pressable>
        ) : null}
        <T size={font.caption} tone="muted">
          {say(
            'Press a key to send it. Long press to add or remove it on the key rail; highlighted keys are on the rail.',
          )}
        </T>
      </ScrollView>
    </View>
  )
}
