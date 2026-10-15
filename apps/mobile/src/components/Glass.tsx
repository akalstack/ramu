import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView, BlurTargetView } from 'expo-blur'
import { GlassContainer, GlassView, isLiquidGlassAvailable, isGlassEffectAPIAvailable } from 'expo-glass-effect'
import { useTheme } from '../theme'

/** iOS 26+ draws real Liquid Glass; older iOS and web get a blurred material; Android 12+ uses native RenderNode blur with tonal fallbacks. */
export const liquidGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()
/** All platforms share the floating layout; each platform supplies its native material. */
export const floatingChrome = true

const BlurSurfaceContext = createContext<{ target: RefObject<View | null>; ready: boolean; markReady(): void } | null>(null)

/** One Android RenderNode target per screen, shared by floating controls. */
export function GlassSurfaceProvider({ children }: { children: ReactNode }) {
  const target = useRef<View>(null)
  const [ready, setReady] = useState(false)
  return <BlurSurfaceContext.Provider value={{ target, ready, markReady: () => setReady(true) }}>{children}</BlurSurfaceContext.Provider>
}
export function BlurSurface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const surface = useContext(BlurSurfaceContext)
  if (Platform.OS !== 'android' || !surface) return children
  return <BlurTargetView ref={surface.target} onLayout={surface.markReady} style={style}><BlurSurfaceContext.Provider value={null}>{children}</BlurSurfaceContext.Provider></BlurTargetView>
}

export function Glass({ children, style, radius, tint, interactive, blur = true }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius: number; tint?: string; interactive?: boolean; blur?: boolean }) {
  const { c, scheme } = useTheme()
  const surface = useContext(BlurSurfaceContext)
  if (liquidGlass) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactive} tintColor={tint} colorScheme={scheme} style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
        {children}
      </GlassView>
    )
  }
  if (Platform.OS === 'android') {
    if (!blur || !surface?.ready || Number(Platform.Version) < 31) return <View style={[{ borderRadius: radius, overflow: 'hidden', backgroundColor: tint ?? c.raised, elevation: 3 }, style]}>{children}</View>
    return <View style={[{ borderRadius: radius, overflow: 'hidden', borderWidth: 0.5, borderColor: c.lineStrong, elevation: 3 }, style]}>
      <BlurView pointerEvents="none" blurTarget={surface.target} blurMethod="dimezisBlurViewSdk31Plus" intensity={60} tint={scheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint ?? (scheme === 'dark' ? 'rgba(44,44,49,0.55)' : 'rgba(255,255,255,0.55)') }]} />
      {children}
    </View>
  }
  return (
    // zIndex keeps the material layers behind non-View children (e.g. SVG icons) on web.
    <View style={[{ borderRadius: radius, overflow: 'hidden', borderWidth: 0.5, borderColor: c.lineStrong, zIndex: 0 }, style]}>
      <BlurView intensity={60} tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'} style={[StyleSheet.absoluteFill, { zIndex: -1 }]} />
      <View style={[StyleSheet.absoluteFill, { zIndex: -1, backgroundColor: tint ?? (scheme === 'dark' ? 'rgba(44,44,49,0.55)' : 'rgba(255,255,255,0.55)') }]} />
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
        <View key={i} style={{ flex: 1, backgroundColor: color ?? c.window, opacity: Math.min(1, ((i + 1) / (steps * 0.5)) ** 1.4) }} />
      ))}
    </View>
  )
}

/** One native glass container coordinates neighboring floating controls on iOS. */
export function GlassGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return liquidGlass ? <GlassContainer spacing={12} style={style}>{children}</GlassContainer> : <View style={style}>{children}</View>
}
