import { closeSync, openSync, readSync, realpathSync } from 'node:fs'
import { findExecutable, providerBinary } from '../providers/providerBinaries'

export interface Ripgrep {
  file: string
  /** Set when `file` is the Claude Code binary, which runs its embedded ripgrep when started under this name. */
  argv0?: string
}

/** A native executable rather than a script or a launcher such as npm's `.cmd` shim, which would not honor argv0. */
function isNativeExecutable(path: string): boolean {
  if (/\.(cmd|bat|ps1|js|mjs|cjs)$/i.test(path)) return false
  try {
    const fd = openSync(realpathSync(path), 'r')
    try {
      const head = Buffer.alloc(2)
      return readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') !== '#!'
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

/** The ripgrep embedded in the person's installed Claude Code, which Ramu already finds to run Claude agents. */
export function claudeCodeRipgrep(binary = providerBinary('claude-code')): Ripgrep | null {
  const path = findExecutable(binary)
  return path && isNativeExecutable(path) ? { file: path, argv0: 'rg' } : null
}

let cached: Ripgrep | null | undefined

/** The person's own ripgrep first, then the copy inside their Claude Code, so search works without installing rg. */
export function ripgrep(): Ripgrep | null {
  if (cached !== undefined) return cached
  const own = ['rg', '/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg']
    .map(findExecutable)
    .find((path) => !!path)
  cached = own ? { file: own } : claudeCodeRipgrep()
  return cached
}
