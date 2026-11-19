import { View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { ErrorBoundaryProps } from 'expo-router'
import { translate } from '@ramu/shared/i18n'
import { space, ThemeProvider, useTheme } from '../theme'
import { Button, T } from './ui'

/** The app's language is in its store, which this screen cannot rely on; the device's language stands in. */
const language = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('id') ? 'id' : 'en'
  } catch {
    return 'en'
  }
})()
const say = (text: string) => translate(language, text)

function Fallback({ error, retry }: ErrorBoundaryProps) {
  const { c } = useTheme()
  return (
    <View
      accessibilityRole="alert"
      style={{ flex: 1, justifyContent: 'center', gap: space.m, padding: space.xl, backgroundColor: c.window }}
    >
      <T weight="600" size={20}>
        {say('Ramu hit a problem')}
      </T>
      <T tone="muted">
        {say(
          'Your drafts and threads are safe. Try again, and if it keeps happening, copy the details for a bug report.',
        )}
      </T>
      <T tone="muted" numberOfLines={4} style={{ fontFamily: 'Menlo' }}>
        {error.message}
      </T>
      <Button title={say('Try again')} onPress={() => void retry()} />
      <Button
        kind="secondary"
        title={say('Copy details')}
        onPress={() => void Clipboard.setStringAsync(`${error.name}: ${error.message}\n${error.stack ?? ''}`)}
      />
    </View>
  )
}

/**
 * Shown instead of Expo Router's developer screen when something below the root layout throws: a calm message,
 * Try again (which renders the app again) and the details to copy.
 */
export function AppErrorBoundary(props: ErrorBoundaryProps) {
  return (
    <ThemeProvider>
      <Fallback {...props} />
    </ThemeProvider>
  )
}
