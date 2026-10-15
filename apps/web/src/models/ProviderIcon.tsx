import type { CSSProperties } from 'react'
import type { AgentProvider } from '@ramu/shared/types'
import claude from '../assets/providers/claude.svg'
import codex from '../assets/providers/openai.svg'
import opencode from '../assets/providers/opencode.svg'
import cursor from '../assets/providers/cursor.svg'
import antigravity from '../assets/providers/antigravity.svg'

const logos: Record<AgentProvider, string> = { 'claude-code': claude, codex, opencode, cursor, antigravity }

/** Local brand assets; monochrome logos inherit the surrounding theme color. */
export function ProviderIcon({
  provider,
  size = 14,
  className = '',
}: {
  provider: AgentProvider
  size?: number | string
  className?: string
}) {
  const classes = `provider-icon ${provider === 'claude-code' ? 'claude' : provider} ${className}`
  if (provider === 'antigravity' || provider === 'opencode')
    return (
      <img
        src={logos[provider]}
        width={size}
        height={size}
        className={classes}
        alt=""
        aria-hidden="true"
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      />
    )
  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    flexShrink: 0,
    backgroundColor: 'currentColor',
    maskImage: `url("${logos[provider]}")`,
    maskSize: 'contain',
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
  }
  return <span className={classes} style={style} aria-hidden="true" />
}
