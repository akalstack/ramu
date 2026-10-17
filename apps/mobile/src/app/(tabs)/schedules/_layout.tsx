import { Platform } from 'react-native'
import { Stack } from 'expo-router'
import { useTheme } from '../../../theme'

export default function TabStack() {
  const { c } = useTheme()
  return <Stack screenOptions={{ headerShown: Platform.OS !== 'web', contentStyle: { backgroundColor: c.window } }} />
}
