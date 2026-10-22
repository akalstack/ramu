import { useMemo } from 'react'
import { SvgXml } from 'react-native-svg'
import type { AgentProvider } from '@ramu/shared/types'
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
export function ProviderIcon({ provider, size = 14 }: { provider: AgentProvider; size?: number }) {
  const { c } = useTheme()
  const tint = provider === 'claude-code' ? '#d97757' : c.soft
  const xml = useMemo(() => (keepsColors(provider) ? svgs[provider] : tinted(svgs[provider], tint)), [provider, tint])
  return <SvgXml xml={xml} width={size} height={size} />
}
