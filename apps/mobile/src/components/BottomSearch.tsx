import { useEffect, useRef } from 'react'
import { Platform, TextInput, View } from 'react-native'
import { Stack } from 'expo-router'
import type { SearchBarCommands } from 'react-native-screens'
import { Search } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import type { SheetSearchProps } from './NativeSheet'

/**
 * The app's one search control; sheets supply their own native toolbar.
 * `bottom` (default) is the iOS 26 bottom search bar, for screens whose content is a plain list.
 * `header` is a search button in the navigation bar that expands in place, for screens with their own bottom actions
 * (a commit box, a composer), so the two never stack over each other. Android shows its header search either way.
 */
export function BottomSearch({
  value,
  onChangeText,
  placeholder,
  label = placeholder,
  onSubmit,
  inputOnly = false,
  placement = 'bottom',
}: SheetSearchProps & { inputOnly?: boolean; placement?: 'bottom' | 'header' }) {
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
          {...(placement === 'header'
            ? { placement: 'integratedButton' as const, allowToolbarIntegration: false }
            : {})}
          onChangeText={(event) => onChangeText(event.nativeEvent.text)}
          onCancelButtonPress={() => onChangeText('')}
          onClose={() => onChangeText('')}
          onSearchButtonPress={onSubmit}
        />
        {Platform.OS === 'ios' && placement === 'bottom' ? (
          <Stack.Toolbar placement="bottom">
            <Stack.Toolbar.SearchBarSlot />
          </Stack.Toolbar>
        ) : null}
      </>
    )
  // Inside a sheet there is no navigation bar to hold the native bar, so this draws its look: a filled capsule with the
  // system's small magnifier. A plain view, not glass: the glass view did not lay its children out as a row, and the
  // field collapsed to the icon as soon as it held text.
  return (
    <View style={{ paddingHorizontal: space.l, paddingVertical: space.s }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: space.m,
          minHeight: 44,
          borderRadius: radius.full,
          backgroundColor: c.fill,
        }}
      >
        <Search size={16} color={c.muted} strokeWidth={2.2} />
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
          style={{ flex: 1, minWidth: 0, minHeight: 44, color: c.text, fontSize: font.body }}
        />
      </View>
    </View>
  )
}
