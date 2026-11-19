import { View, type StyleProp, type ViewStyle } from 'react-native'
import { Host, LoadingIndicator } from '@expo/ui/jetpack-compose'
import { useTheme } from '../theme'

/**
 * Material 3 Expressive's loading indicator (Jetpack Compose), whose shapes morph while a screen's content loads; it
 * replaces the plain spinner where a whole page or section is waiting.
 */
export function PageLoader({ color, style }: { color?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  return (
    <View style={[{ alignSelf: 'center' }, style]} accessibilityRole="progressbar">
      <Host matchContents>
        <LoadingIndicator color={color ?? c.accent} />
      </Host>
    </View>
  )
}
