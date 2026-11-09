import { View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import type { AgentProvider } from '@ramu/shared/types'
import type { BrandId } from '@ramu/shared/brands'
import { svgs } from '../assets/svgs'
import { useTheme } from '../theme'

const marks: Readonly<Record<string, string>> = svgs

/** A mark in its own colors, with its version for dark surfaces when the mark is black, as the desktop shows it. */
export function markXml(key: string, scheme: 'light' | 'dark'): string | undefined {
  return (scheme === 'dark' ? marks[`${key}:dark`] : undefined) ?? marks[key]
}

/** A provider's own mark in its own colors. `muted` fades it, for an agent that worked in a thread earlier and no longer leads it. */
export function ProviderIcon({
  provider,
  size = 14,
  muted,
}: {
  provider: AgentProvider
  size?: number
  muted?: boolean
}) {
  const { scheme } = useTheme()
  return (
    <View style={muted ? { opacity: 0.4 } : undefined}>
      <SvgXml xml={markXml(provider, scheme)!} width={size} height={size} />
    </View>
  )
}

/** A forge, hosting platform or service's own mark in its own colors, beside its name. */
export function BrandIcon({ brand, size = 14 }: { brand: BrandId | undefined; size?: number }) {
  const { scheme } = useTheme()
  const xml = brand ? markXml(`brand:${brand}`, scheme) : undefined
  // A service without a mark here shows none; its name sits beside the space.
  if (!xml) return <View style={{ width: size, height: size }} />
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  )
}
