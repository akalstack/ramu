import { useEffect, useRef } from 'react'
import { Platform, TextInput, View } from 'react-native'
import { Stack } from 'expo-router'
import type { SearchBarCommands } from 'react-native-screens'
import { Search } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import type { SheetSearchProps } from './NativeSheet'

/** One bottom search location; sheets supply their own native toolbar. */
export function BottomSearch({
  value,
  onChangeText,
  placeholder,
  label = placeholder,
  onSubmit,
  inputOnly = false,
}: SheetSearchProps & { inputOnly?: boolean }) {
  const { c } = useTheme()
  const search = useRef<SearchBarCommands>(null)
  useEffect(() => {
    search.current?.setText(value)
  }, [value])
  if (!inputOnly && Platform.OS !== 'web')
    return (
      <>
        <Stack.SearchBar
          ref={search}
          placeholder={placeholder}
          headerIconColor={c.text}
          textColor={c.text}
          hintTextColor={c.muted}
          tintColor={c.accent}
          autoCapitalize="none"
          hideWhenScrolling={false}
          onChangeText={(event) => onChangeText(event.nativeEvent.text)}
          onCancelButtonPress={() => onChangeText('')}
          onClose={() => onChangeText('')}
          onSearchButtonPress={onSubmit}
        />
        {Platform.OS === 'ios' ? (
          <Stack.Toolbar placement="bottom">
            <Stack.Toolbar.SearchBarSlot />
          </Stack.Toolbar>
        ) : null}
      </>
    )
  return (
    <View style={{ padding: space.s, backgroundColor: c.window }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          paddingHorizontal: space.m,
          borderRadius: radius.full,
          backgroundColor: c.raised2,
        }}
      >
        <Search size={18} color={c.muted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          accessibilityLabel={label}
          placeholderTextColor={c.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          clearButtonMode="while-editing"
          style={{ flex: 1, minHeight: 44, color: c.text, fontSize: font.body }}
        />
      </View>
    </View>
  )
}
