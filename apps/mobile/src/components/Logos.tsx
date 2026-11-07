import { useMemo } from 'react'
import { View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import type { AgentProvider } from '@ramu/shared/types'
import type { BrandId } from '@ramu/shared/brands'
import { svgs } from '../assets/svgs'
import { useTheme } from '../theme'

/** OpenCode and Antigravity are full-color assets; the other marks take one tint, as the desktop's CSS masks do. */
const keepsColors = (provider: AgentProvider) => provider === 'opencode' || provider === 'antigravity'

/**
 * Paints every path of a one-color mark. The sources set their color through a missing fill (Claude), `currentColor`
 * (OpenAI) or a CSS class (Cursor), none of which a root `fill` prop reliably overrides, so the tint is written in.
 */
function tinted(xml: string, tint: string) {
  return xml
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/\sclass="[^"]*"/g, '')
    .replace(/\sfill="[^"]*"/g, '')
    .replace(/<(path|circle|rect|polygon|ellipse)\b/g, `<$1 fill="${tint}"`)
}

/** Provider marks shared with the desktop: Claude keeps its orange, OpenAI and Cursor follow the text color, OpenCode and Antigravity keep their asset colors. */
/** `muted` draws a one-color mark in grey, for an agent that worked in a thread earlier and no longer leads it. */
export function ProviderIcon({
  provider,
  size = 14,
  muted,
}: {
  provider: AgentProvider
  size?: number
  muted?: boolean
}) {
  const { c } = useTheme()
  const tint = muted ? c.muted : provider === 'claude-code' ? '#d97757' : c.soft
  const xml = useMemo(() => (keepsColors(provider) ? svgs[provider] : tinted(svgs[provider], tint)), [provider, tint])
  return <SvgXml xml={xml} width={size} height={size} />
}

/** A forge, hosting platform or service's mark beside its name, in the text color like the desktop's masks. */
export function BrandIcon({ brand, size = 14 }: { brand: BrandId | undefined; size?: number }) {
  const { c } = useTheme()
  const xml = useMemo(() => (brand ? tinted(svgs[`brand:${brand}`], c.soft) : null), [brand, c.soft])
  // A service without a mark here shows none; its name sits beside the space.
  if (!xml) return <View style={{ width: size, height: size }} />
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  )
}
