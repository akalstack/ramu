import { ComputerUseProvider } from '../runtime/computerUse'
import { LiveActivityMonitor } from '../components/LiveActivityMonitor'
import { StartupScreen } from '../components/StartupScreen'
import { PushRouting } from '../components/PushRouting'
import { NoticeBanner } from '../components/NoticeBanner'
import { UndoToast } from '../components/UndoToast'
import { Overlays } from '../components/Overlays'
import { InboxBadge } from '../components/InboxBadge'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider, useTheme } from '../theme'
import { useEffect, useMemo } from 'react'
import { Platform, Pressable } from 'react-native'
import { T, setHapticsEnabled } from '../components/ui'
import { StoreProvider, useStore } from '../runtime/store'
import { AutomationProvider } from '../runtime/automation'

// Deep links (and notification taps) into a sheet or chat still get the tabs underneath,
// so sheets present as sheets and back always has somewhere to go.
export const unstable_settings = { initialRouteName: '(tabs)' }

function Navigator() {
  const { c, scheme } = useTheme()
  const store = useStore()
  useEffect(() => setHapticsEnabled(store.drafts.haptics !== 'off'), [store.drafts.haptics])
  // The native bars (header, tab bar) read this theme, so it carries our palette instead of the stock one.
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme
    return {
      ...base,
      colors: { ...base.colors, primary: c.accent, background: c.window, card: c.window, text: c.text, border: c.line },
    }
  }, [scheme, c])
  return (
    <StartupScreen ready={store.ready}>
      {store.error ? (
        <Pressable
          accessibilityRole="button"
          onPress={store.dismissError}
          style={{ backgroundColor: c.badWash, padding: 14, paddingTop: 50 }}
        >
          <T tone="bad">{store.error} · tap to dismiss</T>
        </Pressable>
      ) : null}
      <NoticeBanner />
      <UndoToast />
      <Overlays />
      <InboxBadge />
      <PushRouting />
      <LiveActivityMonitor />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <NavigationThemeProvider value={navigationTheme}>
        <Stack
          screenOptions={{
            title: '',
            headerBackButtonDisplayMode: 'minimal',
            headerShown: Platform.OS !== 'web',
            headerStyle: { backgroundColor: c.window },
            contentStyle: { backgroundColor: c.window },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="activity" />
          <Stack.Screen name="explorer" />
          <Stack.Screen name="file" />
          <Stack.Screen name="chat/[id]/index" />
          <Stack.Screen name="chat/[id]/changes" />
          <Stack.Screen name="chat/[id]/file" />
          <Stack.Screen name="chat/[id]/aside" />
          <Stack.Screen name="chat/[id]/terminal" />
          <Stack.Screen name="terminal" />
          <Stack.Screen name="chat/[id]/scm" />
          <Stack.Screen name="chat/[id]/revision" />
          <Stack.Screen name="new" options={{ presentation: 'card' }} />
          <Stack.Screen name="search" />
          <Stack.Screen name="schedule-edit" options={{ presentation: 'modal' }} />
          <Stack.Screen name="computers" options={{ presentation: 'modal' }} />
          <Stack.Screen name="folders" options={{ presentation: 'modal' }} />
          <Stack.Screen name="pair" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', headerShown: false }} />
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
          <AutomationProvider>
            <ComputerUseProvider>
              <Navigator />
            </ComputerUseProvider>
          </AutomationProvider>
        </StoreProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
