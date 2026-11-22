import { Pressable, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { T, tap } from './ui'

/** One choice in a question or a card: a radio or a checkbox row with an optional description. */
export function Option({
  label,
  description,
  selected,
  multi,
  onPress,
}: {
  label: string
  description?: string
  selected: boolean
  multi: boolean
  onPress?: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled: !onPress }}
      disabled={!onPress}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.m,
        padding: space.m,
        borderRadius: radius.s + 2,
        backgroundColor: selected ? c.accentWash : pressed ? c.pressed : c.fill,
      })}
    >
      <View
        style={{
          width: 18,
          height: 18,
          marginTop: 1,
          borderRadius: multi ? 5 : 9,
          borderWidth: 1.5,
          borderColor: selected ? c.primary : c.lineStrong,
          backgroundColor: selected ? c.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Check size={11} color={c.primaryInk} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={font.body - 1} weight="500">
          {label}
        </T>
        {description ? (
          <T size={font.caption + 1} tone="muted" style={{ lineHeight: 18 }}>
            {description}
          </T>
        ) : null}
      </View>
    </Pressable>
  )
}
