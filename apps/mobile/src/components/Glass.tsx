import { useEffect, type ReactNode } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { BlurView } from 'expo-blur'
import { GlassView, isLiquidGlassAvailable, isGlassEffectAPIAvailable } from 'expo-glass-effect'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme'

/** iOS 26+ draws real Liquid Glass; older iOS and web get a blurred material; Android uses an opaque Material surface. */
export const liquidGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()
/** All platforms share the floating layout; each platform supplies its native material. */
export const floatingChrome = true

export function Glass({
  children,
  style,
  radius,
  tint,
  interactive,
  floating,
}: {
  children?: ReactNode
  style?: StyleProp<ViewStyle>
  radius: number
  tint?: string
  interactive?: boolean
  /** Sits over other content (a notice, a toast), so Android lifts it off the screen instead of drawing it flat. */
  floating?: boolean
}) {
  const { c, scheme } = useTheme()
  if (liquidGlass) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tint}
        colorScheme={scheme}
        style={[{ borderRadius: radius, overflow: 'hidden' }, style]}
      >
        {children}
      </GlassView>
    )
  }
  if (Platform.OS === 'android') {
    // Flat, opaque Material surfaces. Elevation belongs to individual controls, not every surface.
    return (
      <View
        style={[
          {
            borderRadius: radius,
            overflow: 'hidden',
            backgroundColor: tint ?? c.raised2,
            elevation: floating ? 6 : 0,
          },
          floating ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.lineStrong } : null,
          style,
        ]}
      >
        {children}
      </View>
    )
  }
  return (
    // zIndex keeps the material layers behind non-View children (e.g. SVG icons) on web.
    <View
      style={[
        { borderRadius: radius, overflow: 'hidden', borderWidth: 0.5, borderColor: c.lineStrong, zIndex: 0 },
        style,
      ]}
    >
      <BlurView
        intensity={60}
        tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={[StyleSheet.absoluteFill, { zIndex: -1 }]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            zIndex: -1,
            backgroundColor: tint ?? (scheme === 'dark' ? 'rgba(44,44,49,0.55)' : 'rgba(255,255,255,0.55)'),
          },
        ]}
      />
      {children}
    </View>
  )
}

/** Keeps content legible behind the floating bottom controls. */
export function BottomFade({ height, color }: { height: number; color?: string }) {
  const { c } = useTheme()
  if (!floatingChrome) return null
  const steps = 12
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height }}>
      {Array.from({ length: steps }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            backgroundColor: color ?? c.window,
            opacity: Math.min(1, ((i + 1) / (steps * 0.5)) ** 1.4),
          }}
        />
      ))}
    </View>
  )
}

/**
 * Stand-in for the UIKit scroll-edge effect where the native one is unavailable: clear while the content
 * rests at the top, then a soft fade beneath the transparent navigation bar once it scrolls under it.
 */
export function TopFade({
  visible,
  color,
  belowBar = false,
}: {
  visible: boolean
  color?: string
  /** The screen starts below an opaque native bar, which already covers the status bar: only a short edge is needed. */
  belowBar?: boolean
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const opacity = useSharedValue(0)
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 180 })
  }, [visible, opacity])
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const steps = 12
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: belowBar ? 20 : insets.top + 44 + 20 }, fade]}
    >
      {Array.from({ length: steps }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            backgroundColor: color ?? c.window,
            opacity: Math.min(1, ((steps - i) / (steps * 0.5)) ** 1.4),
          }}
        />
      ))}
    </Reanimated.View>
  )
}
