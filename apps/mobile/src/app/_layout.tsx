import { PageWidgetSync } from '../components/PageWidgetSync'
import { PhoneBackup } from '../components/PhoneBackup'
import { AccountHosts } from '../components/AccountHosts'
import { ComputerUseProvider } from '../runtime/computerUse'
import { LiveActivityMonitor } from '../components/LiveActivityMonitor'
import { StartupScreen } from '../components/StartupScreen'
import { PushRouting } from '../components/PushRouting'
import { NoticeBanner } from '../components/NoticeBanner'
import { UndoToast } from '../components/UndoToast'
import { showError } from '../runtime/toast'
import { Overlays } from '../components/Overlays'
import { InboxBadge } from '../components/InboxBadge'
import { ModelNewsToast } from '../components/ModelNewsToast'
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
  usePathname,
  useRouter,
} from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { arrivalAnimation } from '../runtime/navigation'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardMotion } from '../components/Keyboard'
import { ThemeProvider, useTheme } from '../theme'
import { useEffect, useMemo, useRef } from 'react'
import { Platform } from 'react-native'
import { setHapticsEnabled } from '../components/ui'
import { StoreProvider, useStore } from '../runtime/store'
import { AutomationProvider } from '../runtime/automation'
import { WELCOME_DISMISSED, showWelcome } from '../runtime/pairingModel'
import { ONBOARDING_STEP, resumesOnboarding } from '../runtime/onboardingModel'

// Deep links (and notification taps) into a sheet or chat still get the tabs underneath,
// so sheets present as sheets and back always has somewhere to go.
export const unstable_settings = { anchor: '(tabs)' }

// A crash anywhere below shows a recoverable screen instead of the developer error screen.
export { AppErrorBoundary as ErrorBoundary } from '../components/AppErrorBoundary'

/**
 * Opens the first-run steps once per launch on a phone with no host, or one that left them part way after pairing, unless
 * a link opened another screen.
 */
function WelcomeGate() {
  const store = useStore()
  const router = useRouter()
  const path = usePathname()
  const checked = useRef(false)
  useEffect(() => {
    if (!store.ready || checked.current) return
    checked.current = true
    const hosts = store.computers.length
    // A first run left part way after pairing (before notifications or done) resumes where it was.
    const resuming = resumesOnboarding(store.drafts[ONBOARDING_STEP], hosts) && path === '/'
    if (!resuming && !showWelcome({ hosts, dismissed: store.drafts[WELCOME_DISMISSED] === 'yes', path })) return
    const frame = requestAnimationFrame(() => router.push('/welcome'))
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once, when the saved state has loaded
  }, [store.ready])
  return null
}

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
  // Errors show as a toast under the header and clear themselves.
  const error = store.error
  useEffect(() => {
    if (!error) return
    showError(error)
    store.dismissError()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shows each new error once; the store's methods are stable
  }, [error])
  return (
    <StartupScreen ready={store.ready}>
      <NoticeBanner />
      <UndoToast />
      <Overlays />
      <InboxBadge />
      <ModelNewsToast />
      <PushRouting />
      <LiveActivityMonitor />
      <PageWidgetSync />
      <PhoneBackup />
      <AccountHosts />
      <WelcomeGate />
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
          <Stack.Screen name="host-files" />
          <Stack.Screen
            name="chat/[id]/index"
            options={({ route }) => ({
              animation: arrivalAnimation((route.params as { started?: string } | undefined)?.started),
            })}
          />
          <Stack.Screen name="chat/[id]/changes" />
          <Stack.Screen name="chat/[id]/file" />
          <Stack.Screen name="chat/[id]/aside" />
          <Stack.Screen name="chat/[id]/terminal" />
          <Stack.Screen name="terminal" />
          <Stack.Screen name="chat/[id]/scm" />
          <Stack.Screen name="chat/[id]/revision" />
          <Stack.Screen name="chat/[id]/pull-request" />
          <Stack.Screen name="schedules/index" />
          <Stack.Screen name="schedules/[id]" />
          <Stack.Screen name="pull-request" />
          <Stack.Screen name="chat/[id]/conflict" />
          <Stack.Screen name="new" options={{ presentation: 'card' }} />
          <Stack.Screen name="search" />
          <Stack.Screen name="schedule-edit" options={{ presentation: 'modal' }} />
          <Stack.Screen name="computers" options={{ presentation: 'modal' }} />
          <Stack.Screen name="devices" options={{ presentation: 'modal' }} />
          <Stack.Screen name="folders" options={{ presentation: 'modal' }} />
          <Stack.Screen name="pair" options={{ presentation: 'modal' }} />
          <Stack.Screen name="welcome" options={{ presentation: 'fullScreenModal', headerShown: false }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', headerShown: false }} />
        </Stack>
      </NavigationThemeProvider>
    </StartupScreen>
  )
}

// A development build keeps the screen on while it runs (Expo's dev tools hold a wake lock); released apps never do.
// Let it go, so testing shows the same sleep and battery behavior people get.
if (__DEV__)
  void import('expo-keep-awake')
    .then(({ deactivateKeepAwake, ExpoKeepAwakeTag }) =>
      setTimeout(() => void deactivateKeepAwake(ExpoKeepAwakeTag).catch(() => {}), 1000),
    )
    .catch(() => {})

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardMotion>
        <ThemeProvider>
          <StoreProvider>
            <AutomationProvider>
              <ComputerUseProvider>
                <Navigator />
              </ComputerUseProvider>
            </AutomationProvider>
          </StoreProvider>
        </ThemeProvider>
      </KeyboardMotion>
    </SafeAreaProvider>
  )
}
