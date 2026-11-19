// Finding and starting a plugin's CLI on the host, for platform_cli, plugin authoring and narration.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findExecutable } from '../providers/providerBinaries'

/** Packaged apps may start without the shell's PATH, so look in the usual install locations too. */
export function platformCli(name: string): string | null {
  return (
    findExecutable(name) ??
    ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
      .map((dir) => join(dir, name))
      .find((path) => existsSync(path)) ??
    null
  )
}

/** Only what a CLI needs to run: no agent markers (which switch CLIs to agent output), no Ramu secrets. */
export function cliEnvironment(home: string): NodeJS.ProcessEnv {
  const keep = ['PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'SystemRoot']
  return {
    ...Object.fromEntries(keep.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : []))),
    HOME: home,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
}
