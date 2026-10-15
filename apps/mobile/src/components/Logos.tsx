import { SvgXml } from 'react-native-svg'
import type { AgentProvider } from '@ramu/shared/types'
import { svgs } from '../assets/svgs'
import { useTheme } from '../theme'

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
