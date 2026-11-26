import { TextInput, View } from 'react-native'
import { Search, X } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { IconButton } from './ui'

/** The search field that leads a list (Pull requests, Artifacts): one height, surface, mark and clear button. */
export function ListSearch({
  value,
  onChangeText,
  label,
}: {
  value: string
  onChangeText: (text: string) => void
  /** What it searches, as both the placeholder and the accessible name. */
  label: string
}) {
  const { c } = useTheme()
  const say = useSay()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        marginHorizontal: space.l,
        marginTop: space.m,
        height: 44,
        paddingLeft: space.m,
        paddingRight: value ? 4 : space.m,
        borderRadius: radius.m,
        backgroundColor: c.raised2,
      }}
    >
      <Search size={16} color={c.muted} />
      <TextInput
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={c.placeholder}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, alignSelf: 'stretch', color: c.text, fontSize: font.body }}
      />
      {value ? (
        <IconButton icon={X} label={say('Clear search')} size={36} tone="muted" onPress={() => onChangeText('')} />
      ) : null}
    </View>
  )
}
