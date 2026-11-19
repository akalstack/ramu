// Starts, pins and supervises the workspace server that ships inside the desktop app.
import { spawn, execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  cpSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { runtimeBuild, runtimeVersion } from '@ramu/server/build'
import { runtimeInvoke, runtimeSocket, forgetHostSocket } from '@ramu/client-runtime'

/** A packaged daemon must not lazy-load code from an app bundle being updated. */
export function pinnedRuntime(
  userData: string,
  daemonPath: string,
  executable = process.execPath,
  platform: NodeJS.Platform = process.platform,
) {
  // A Linux package is the folder holding its executable: /usr/lib/ramu for the .deb, a temporary mount for an AppImage.
  const bundle =
    platform === 'darwin' && executable.includes('.app/Contents/MacOS/')
      ? executable.slice(0, executable.indexOf('.app/Contents/MacOS/') + 4)
      : platform === 'linux'
        ? dirname(executable)
        : null
  // Development runs a bare Electron too, but its daemon lives in the repository.
  if (!bundle || !daemonPath.startsWith(`${bundle}/`)) return { daemonPath, executable }
  const destination = join(
    userData,
    'background-runtimes',
    runtimeBuild(daemonPath),
    platform === 'darwin' ? 'Ramu.app' : 'Ramu',
  )
  if (!existsSync(destination)) {
    const temporary = `${destination}.partial`
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    rmSync(temporary, { recursive: true, force: true })
    cpSync(bundle, temporary, { recursive: true, dereference: false })
    renameSync(temporary, destination)
  }
  return {
    daemonPath: join(destination, relative(bundle, daemonPath)),
    executable: join(destination, relative(bundle, executable)),
  }
}
export async function ensureRuntime(
  userData: string,
  daemonPath: string,
  executable = process.execPath,
): Promise<string> {
  mkdirSync(userData, { recursive: true })
  const socketPath = runtimeSocket(userData)
  try {
    const status = await runtimeInvoke(socketPath, 'background.status')
    // A version mismatch is shown to the user. App launch/restart never replaces
    // a healthy service, because it may own running chats.
    if (status?.running) return socketPath
  } catch (error) {
    if ((error as { status?: number }).status === 426) {
      forgetHostSocket({ kind: 'socket', path: socketPath })
      throw new Error(
        'The background service needs to restart before Ramu can open. Restart the service and try again. Running agents have been left untouched.',
        { cause: error },
      )
    }
    if (!['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
  try {
    unlinkSync(join(userData, 'background.stopped'))
  } catch {}
  try {
    unlinkSync(socketPath)
  } catch {}
  const log = openSync(join(userData, 'background.log'), 'a', 0o600)
  const pinned = pinnedRuntime(userData, daemonPath, executable)
  const child = spawn(pinned.executable, [pinned.daemonPath], {
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      RAMU_APP_VERSION: runtimeVersion(daemonPath),
      RAMU_USER_DATA: userData,
      RAMU_SOCKET: socketPath,
      ...desktopApp(),
    },
  })
  child.on('error', () => {})
  child.unref()
  closeSync(log)
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    try {
      await runtimeInvoke(socketPath, 'background.status')
      return socketPath
    } catch {}
  }
  throw new Error(`Background service could not start. See ${join(userData, 'background.log')}`)
}
/**
 * Waits for a service told to restart to let go of its socket. It drains running agents and jobs first and stops
 * answering while it does, so an unanswered call does not mean it is gone; it removes its socket file last.
 */
export async function waitForRuntimeExit(socketPath: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  try {
    while (existsSync(socketPath)) {
      if (Date.now() > deadline)
        throw new Error('The background service is still stopping its running agents. Open Ramu again in a moment.')
      // A fresh connection each time, so a refused one is reported at once rather than retried on the old one.
      forgetHostSocket({ kind: 'socket', path: socketPath })
      try {
        await runtimeInvoke(socketPath, 'background.status', [], { timeoutMs: 1000 })
      } catch (error) {
        // A socket file nothing listens on is left from a service that has already exited.
        if (['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  } finally {
    forgetHostSocket({ kind: 'socket', path: socketPath })
  }
}
/**
 * The installed app, so the service can open it to show a pairing request while it is closed. Development runs
 * (`electron .`) leave it out: their executable is a bare Electron.
 */
const desktopApp = (): Record<string, string> =>
  process.defaultApp || !process.versions.electron
    ? {}
    : // An AppImage runs from a mount that is gone once it quits; the image file itself opens it again.
      { RAMU_DESKTOP_APP: process.env.APPIMAGE ?? process.execPath }
const xml = (text: string) =>
  text.replace(/[<>&"']/g, (s) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[s]!)
const serviceLabel = (userData: string) =>
  `app.ramu.background.${createHash('sha256').update(userData).digest('hex').slice(0, 12)}`
/** The environment the login-started service runs with, the same one the app starts it with. */
function serviceEnvironment(userData: string, daemonPath: string): Record<string, string> {
  return {
    RAMU_SUPERVISOR: '1',
    ELECTRON_RUN_AS_NODE: '1',
    RAMU_APP_VERSION: runtimeVersion(daemonPath),
    RAMU_USER_DATA: userData,
    RAMU_SOCKET: runtimeSocket(userData),
    ...desktopApp(),
    PATH: process.env.PATH ?? '/usr/bin:/bin:/opt/homebrew/bin',
    ...(process.env.RAMU_WORKTREES ? { RAMU_WORKTREES: process.env.RAMU_WORKTREES } : {}),
  }
}
const systemdUnitDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user')
const systemctl = (...args: string[]) => execFileSync('systemctl', ['--user', ...args], { stdio: 'ignore' })
/** Whether this computer can start the service at login: macOS always, Linux with a systemd user session. */
export function loginSupported(): boolean {
  if (process.platform === 'darwin') return true
  if (process.platform !== 'linux') return false
  try {
    systemctl('show-environment')
    return true
  } catch {
    return false
  }
}
/** A systemd value in double quotes; `%` would otherwise expand as a specifier. */
const unitQuote = (text: string) => `"${text.replace(/[\\"]/g, (s) => `\\${s}`).replace(/%/g, '%%')}"`
/**
 * The systemd user service that starts the background service at login. Like the macOS LaunchAgent it restarts a
 * crashed service but not one that exited on purpose, such as a second copy finding the first already running.
 */
export function systemdUnit(executable: string, daemonPath: string, env: Record<string, string>, log: string) {
  return [
    '[Unit]',
    'Description=Ramu background service',
    '',
    '[Service]',
    `ExecStart=${unitQuote(executable)} ${unitQuote(daemonPath)}`,
    ...Object.entries(env).map(([key, value]) => `Environment=${unitQuote(`${key}=${value}`)}`),
    'Restart=on-failure',
    'KillMode=process',
    `StandardOutput=append:${log.replace(/%/g, '%%')}`,
    `StandardError=append:${log.replace(/%/g, '%%')}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}
function linuxLoginService(userData: string, daemonPath: string, enabled: boolean) {
  const unit = `${serviceLabel(userData)}.service`,
    dir = systemdUnitDir(),
    path = join(dir, unit)
  writeFileSync(join(userData, 'background-startup.json'), JSON.stringify(enabled))
  if (!enabled) {
    // Disabling leaves a running service alone, as on macOS; it just will not start at the next login.
    try {
      systemctl('disable', unit)
    } catch {}
    try {
      unlinkSync(path)
    } catch {}
    try {
      systemctl('daemon-reload')
    } catch {}
    return
  }
  const pinned = pinnedRuntime(userData, daemonPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path,
    systemdUnit(
      pinned.executable,
      pinned.daemonPath,
      serviceEnvironment(userData, pinned.daemonPath),
      join(userData, 'background.log'),
    ),
    { mode: 0o600 },
  )
  systemctl('daemon-reload')
  systemctl('enable', unit)
  // The app may already run the service; this copy then exits cleanly and systemd leaves it stopped.
  try {
    systemctl('start', unit)
  } catch {}
}
export function loginService(userData: string, daemonPath: string, enabled: boolean): void {
  if (process.platform === 'linux') return linuxLoginService(userData, daemonPath, enabled)
  if (process.platform !== 'darwin') throw new Error('Starting the service at login is not supported on this system')
  const label = serviceLabel(userData)
  const dir = join(homedir(), 'Library', 'LaunchAgents'),
    path = join(dir, `${label}.plist`),
    domain = `gui/${process.getuid!()}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(userData, 'background-startup.json'), JSON.stringify(enabled))
  if (!enabled) {
    try {
      execFileSync('/bin/launchctl', ['disable', `${domain}/${label}`], { stdio: 'ignore' })
    } catch {}
    try {
      unlinkSync(path)
    } catch {}
    return
  }
  const pinned = pinnedRuntime(userData, daemonPath)
  const env = serviceEnvironment(userData, daemonPath)
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(pinned.executable)}</string><string>${xml(pinned.daemonPath)}</string></array><key>EnvironmentVariables</key><dict>${Object.entries(
      env,
    )
      .map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`)
      .join(
        '',
      )}</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>StandardOutPath</key><string>${xml(join(userData, 'background.log'))}</string><key>StandardErrorPath</key><string>${xml(join(userData, 'background.log'))}</string></dict></plist>`,
    { mode: 0o600 },
  )
  execFileSync('/bin/launchctl', ['enable', `${domain}/${label}`], { stdio: 'ignore' })
  try {
    execFileSync('/bin/launchctl', ['bootstrap', domain, path], { stdio: 'ignore' })
  } catch (error) {
    try {
      execFileSync('/bin/launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' })
    } catch {
      throw error
    }
  }
  try {
    execFileSync('/bin/launchctl', ['kickstart', `${domain}/${label}`], { stdio: 'ignore' })
  } catch {}
}
export function unloadLoginService(userData: string) {
  if (process.platform === 'linux') {
    try {
      systemctl('stop', `${serviceLabel(userData)}.service`)
    } catch {}
    return
  }
  if (process.platform !== 'darwin') return
  const label = serviceLabel(userData)
  try {
    execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid!()}/${label}`], { stdio: 'ignore' })
  } catch {}
}
export function loginPreferred(userData: string): boolean | null {
  try {
    return JSON.parse(readFileSync(join(userData, 'background-startup.json'), 'utf8')) === true
  } catch {
    return null
  }
}
export function loginEnabled(userData: string): boolean {
  const label = serviceLabel(userData)
  if (process.platform === 'linux') return existsSync(join(systemdUnitDir(), `${label}.service`))
  return existsSync(join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`))
}
