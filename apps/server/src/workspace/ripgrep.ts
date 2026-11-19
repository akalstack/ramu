import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { findExecutable } from '../providers/providerBinaries'

export interface Ripgrep {
  file: string
  /** Set when `file` is the Claude Code binary, which runs its embedded ripgrep when started under this name. */
  argv0?: string
}

/** The ripgrep inside the Claude Code binary Ramu already ships with the Agent SDK, found the way the SDK finds it. */
export function bundledRipgrep(platform = process.platform, arch = process.arch): Ripgrep | null {
  try {
    const sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
    const fromSdk = createRequire(sdk)
    const suffix = platform === 'win32' ? '.exe' : ''
    const names = platform === 'linux' ? [`linux-${arch}`, `linux-${arch}-musl`] : [`${platform}-${arch}`]
    for (const name of names) {
      try {
        const path = fromSdk.resolve(`@anthropic-ai/claude-agent-sdk-${name}/claude${suffix}`)
        if (existsSync(path)) return { file: path, argv0: 'rg' }
      } catch {}
    }
  } catch {}
  return null
}

let cached: Ripgrep | null | undefined

/** The person's own ripgrep first, then the copy inside the bundled Claude binary, so search works with no install. */
export function ripgrep(): Ripgrep | null {
  if (cached !== undefined) return cached
  const own = ['rg', '/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg']
    .map(findExecutable)
    .find((path) => !!path)
  cached = own ? { file: own } : bundledRipgrep()
  return cached
}
