import { ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native'

/** What a screen shows while its content loads: the platform spinner here, Material 3's loading indicator on Android. */
export function PageLoader({ color, style }: { color?: string; style?: StyleProp<ViewStyle> }) {
  return <ActivityIndicator color={color} style={style} />
}
