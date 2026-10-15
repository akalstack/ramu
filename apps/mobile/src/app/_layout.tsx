import { LiveActivityMonitor } from '../components/LiveActivityMonitor'
import { StartupScreen } from '../components/StartupScreen'
import { PushRouting } from '../components/PushRouting'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider, useTheme } from '../theme'
import { Platform, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { T } from '../components/ui'
import { StoreProvider, useStore } from '../runtime/store'

// Deep links (and later, notification taps) into a sheet or chat still get Home underneath,
// so sheets present as sheets and back always has somewhere to go.
export const unstable_settings = { initialRouteName: 'index' }

function Navigator() {
  const { c, scheme } = useTheme()
  const store = useStore()
  const router = useRouter()
  return (
    <StartupScreen ready={store.ready}>
      {store.error ? <Pressable accessibilityRole="button" onPress={store.dismissError} style={{ backgroundColor: c.badWash, padding: 14, paddingTop: 50 }}><T tone="bad">{store.error} · tap to dismiss</T></Pressable> : null}
      {store.notifications[0] ? <Pressable onPress={() => { const notice = store.notifications[0]!; store.select(notice.computerId); store.dismissNotification(0); router.push({ pathname: '/chat/[id]', params: { id: notice.chatId } }) }} style={{ backgroundColor: c.accentWash, padding: 14 }}><T>{store.computers.find(pc => pc.id === store.notifications[0]?.computerId)?.name} · {store.notifications[0].title}</T><T tone="muted">{store.notifications[0].body}</T></Pressable> : null}
      <PushRouting />
      <LiveActivityMonitor />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <NavigationThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: Platform.OS !== 'web', contentStyle: { backgroundColor: c.window } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="activity" />
        <Stack.Screen name="chat/[id]/index" />
        <Stack.Screen name="chat/[id]/changes" />
        <Stack.Screen name="chat/[id]/terminal" />
        <Stack.Screen name="chat/[id]/scm" />
        <Stack.Screen name="new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="computers" options={{ presentation: 'modal' }} />
        <Stack.Screen name="folders" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pair" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      </Stack>
      </NavigationThemeProvider>
    </StartupScreen>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StoreProvider>
          <Navigator />
        </StoreProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
