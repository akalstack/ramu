// Puts a `ramu` command on the person's PATH that runs the CLI shipped inside this app with the app's own runtime, so a
// terminal always talks to the same build as the app and the background service, and needs no Node.js of its own.
import { execFile } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import type { TerminalCommandStatus } from '@ramu/shared/types'
import { t } from './localization'

/** Identifies a launcher this app wrote, so one from another program is never replaced or removed. */
const MARKER = '# Installed by the Ramu app.'
const PROFILE_MARKER = '# Added by Ramu so terminals find the ramu command'

export type CommandTarget =
  { executable: string; cli: string } | { unavailable: 'development' | 'appimage' | 'translocated' | 'platform' }

/** What the command runs, or why this app cannot offer one. */
export function commandTarget(options: {
  executable: string
  cli: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  development: boolean
}): CommandTarget {
  if (options.development) return { unavailable: 'development' }
  if (options.platform !== 'darwin' && options.platform !== 'linux') return { unavailable: 'platform' }
  // An AppImage mounts at a new path each launch, and macOS runs an app opened straight from Downloads from a random
  // translocated copy; either way a launcher would point nowhere once the app quits.
  if (options.env.APPIMAGE) return { unavailable: 'appimage' }
  if (options.executable.includes('/AppTranslocation/')) return { unavailable: 'translocated' }
  return { executable: options.executable, cli: options.cli }
}

const sh = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

export function launcher(target: { executable: string; cli: string }, userData: string): string {
  return `#!/bin/sh
${MARKER} Remove it in Settings > Background & updates.
app=${sh(target.executable)}
if [ ! -x "$app" ]; then
  echo "ramu: Ramu is no longer at $app. Open Ramu and install the terminal command again in Settings." >&2
  exit 127
fi
if [ -z "$RAMU_USER_DATA" ]; then RAMU_USER_DATA=${sh(userData)}; fi
export RAMU_USER_DATA
ELECTRON_RUN_AS_NODE=1 RAMU_TERMINAL_COMMAND=1 exec "$app" ${sh(target.cli)} "$@"
`
}

/** The startup file Ramu adds the command's folder to for this shell, and the line it adds; null for other shells. */
export function shellProfile(
  shell: string | undefined,
  home: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { path: string; line: string } | null {
  const posix = 'export PATH="$HOME/.local/bin:$PATH"'
  const name = shell ? basename(shell) : ''
  if (name === 'zsh') return { path: join(env.ZDOTDIR || home, '.zshrc'), line: posix }
  // macOS terminals start login shells, which read .bash_profile; Linux terminals read .bashrc.
  if (name === 'bash') return { path: join(home, platform === 'darwin' ? '.bash_profile' : '.bashrc'), line: posix }
  if (name === 'fish')
    return {
      path: join(env.XDG_CONFIG_HOME || join(home, '.config'), 'fish', 'conf.d', 'ramu.fish'),
      line: 'fish_add_path -g $HOME/.local/bin',
    }
  return null
}

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The PATH a new terminal gets. The app's own PATH is the bare system one when it was opened from the Dock. */
function loginShellPath(shell: string | undefined): Promise<string | null> {
  if (!shell) return Promise.resolve(null)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((resolve) =>
    // Interactive startup files may print a greeting, so the value follows a marker on its own line.
    execFile(shell, ['-ilc', 'printf "\\n__RAMU_PATH__%s\\n" "$PATH"'], { env, timeout: 5000 }, (error, stdout) => {
      const line = String(stdout)
        .split('\n')
        .find((entry) => entry.startsWith('__RAMU_PATH__'))
      resolve(error && !line ? null : (line?.slice('__RAMU_PATH__'.length) ?? null))
    }),
  )
}

export interface TerminalCommandOptions {
  target: CommandTarget
  userData: string
  home?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** The PATH new terminals get; reads the login shell's by default. */
  shellPath?: () => Promise<string | null>
}

export function terminalCommand(options: TerminalCommandOptions) {
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const dir = join(home, '.local', 'bin')
  const path = join(dir, 'ramu')
  const profile = shellProfile(env.SHELL, home, platform, env)
  const shellPath = options.shellPath ?? (() => loginShellPath(env.SHELL))
  const target = options.target
  const ours = (text: string | null) => text !== null && text.includes(MARKER)
  const profileAdded = () => !!profile && !!read(profile.path)?.includes(PROFILE_MARKER)
  const onPath = async () => profileAdded() || !!(await shellPath())?.split(delimiter).includes(dir)

  const write = (text: string) => {
    mkdirSync(dir, { recursive: true })
    const temporary = `${path}.${process.pid}.partial`
    writeFileSync(temporary, text, { mode: 0o755 })
    chmodSync(temporary, 0o755)
    renameSync(temporary, path)
  }

  async function status(): Promise<TerminalCommandStatus> {
    const current = read(path)
    return {
      ...('unavailable' in target ? { unavailable: target.unavailable } : {}),
      installed: ours(current),
      path,
      taken: current !== null && !ours(current),
      onPath: await onPath(),
    }
  }

  return {
    status,
    /** Writes the command, then makes sure new terminals find it. Throws when another program's `ramu` is there. */
    async install(): Promise<TerminalCommandStatus> {
      if ('unavailable' in target) throw new Error(t('Not available on this computer'))
      const current = read(path)
      if (current !== null && !ours(current))
        throw new Error(t('{0} belongs to another program, so Ramu leaves it alone.', { 0: path }))
      write(launcher(target, options.userData))
      if (profile && !(await onPath())) {
        mkdirSync(dirname(profile.path), { recursive: true })
        const existing = read(profile.path)
        appendFileSync(
          profile.path,
          `${existing && !existing.endsWith('\n') ? '\n' : ''}\n${PROFILE_MARKER}\n${profile.line}\n`,
        )
      }
      return status()
    },
    /** Removes only a command this app wrote. The PATH line stays: other tools may live in that folder by now. */
    async remove(): Promise<TerminalCommandStatus> {
      if (ours(read(path))) rmSync(path, { force: true })
      return status()
    },
    /** Points an installed command at this copy of the app, after it moved or was installed somewhere else. */
    refresh() {
      if ('unavailable' in target) return
      const current = read(path)
      const next = launcher(target, options.userData)
      if (ours(current) && current !== next) write(next)
    },
  }
}
