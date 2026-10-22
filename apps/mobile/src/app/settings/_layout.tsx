import { Platform } from 'react-native'
import { Stack } from 'expo-router'
import { useTheme } from '../../theme'

// Settings is a sheet over Home with its own stack: the menu first, then one page per section.
export const unstable_settings = { initialRouteName: 'index' }

export default function SettingsLayout() {
  const { c } = useTheme()
  return (
    <Stack
      screenOptions={{
        title: '',
        headerBackButtonDisplayMode: 'minimal',
        headerShown: Platform.OS !== 'web',
        headerStyle: { backgroundColor: c.window },
        contentStyle: { backgroundColor: c.window },
      }}
    />
  )
}
