import { View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import type { AgentProvider } from '@ramu/shared/types'
import { svgs } from '../assets/svgs'
import { useTheme } from '../theme'

/** The "ramu." wordmark from assets/wordmark.svg, tinted for the current theme. */
export function Wordmark({ height = 20 }: { height?: number }) {
  const { c } = useTheme()
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Ramu">
      <SvgXml xml={svgs.wordmark} height={height} width={(height * 367.579) / 80} color={c.text} />
    </View>
  )
}

/** Provider marks shared with the desktop: Claude keeps its orange, OpenAI and Cursor follow the text color, OpenCode and Antigravity keep their asset colors. */
export function ProviderIcon({ provider, size = 14 }: { provider: AgentProvider; size?: number }) {
  const { c } = useTheme()
  const tint = provider === 'claude-code' ? '#d97757' : c.soft
  return (
    <SvgXml
      xml={svgs[provider]}
      width={size}
      height={size}
      color={tint}
      fill={provider === 'opencode' || provider === 'antigravity' ? undefined : tint}
    />
  )
}
