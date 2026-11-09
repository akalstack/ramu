import type { AgentProvider } from '@ramu/shared/types'
import claude from '../assets/providers/claude.svg'
import codex from '../assets/providers/openai.svg'
import codexDark from '../assets/providers/openai-dark.svg'
import opencode from '../assets/providers/opencode.svg'
import opencodeDark from '../assets/providers/opencode-dark.svg'
import cursor from '../assets/providers/cursor.svg'
import cursorDark from '../assets/providers/cursor-dark.svg'
import antigravity from '../assets/providers/antigravity.svg'
import { useResolvedAppearance } from '../appearance'

/** Each provider's own mark in its own colors; a black mark has a light version for dark surfaces. */
const LOGOS: Record<AgentProvider, { light: string; dark?: string }> = {
  'claude-code': { light: claude },
  codex: { light: codex, dark: codexDark },
  opencode: { light: opencode, dark: opencodeDark },
  cursor: { light: cursor, dark: cursorDark },
  antigravity: { light: antigravity },
}

export function ProviderIcon({
  provider,
  size = 14,
  className = '',
}: {
  provider: AgentProvider
  size?: number | string
  className?: string
}) {
  const appearance = useResolvedAppearance()
  const logo = LOGOS[provider]
  return (
    <img
      src={appearance === 'dark' ? (logo.dark ?? logo.light) : logo.light}
      width={size}
      height={size}
      className={`provider-icon ${className}`}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  )
}
