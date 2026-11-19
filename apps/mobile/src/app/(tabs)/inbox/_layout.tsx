import { Platform } from 'react-native'
import { Stack } from 'expo-router'
import { useTheme } from '../../../theme'

export default function TabStack() {
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
