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
export function pinnedRuntime(userData: string, daemonPath: string, executable = process.execPath) {
  if (process.platform !== 'darwin' || !executable.includes('.app/Contents/MacOS/')) return { daemonPath, executable }
  const bundle = executable.slice(0, executable.indexOf('.app/Contents/MacOS/') + 4)
  // Development uses Electron.app too, but its daemon lives in the repository.
  if (!daemonPath.startsWith(`${bundle}/`)) return { daemonPath, executable }
  const destination = join(userData, 'background-runtimes', runtimeBuild(daemonPath), 'Ramu.app')
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
 * The installed app, so the service can open it to show a pairing request while it is closed. Development runs
 * (`electron .`) leave it out: their executable is a bare Electron.
 */
const desktopApp = (): Record<string, string> =>
  process.defaultApp || !process.versions.electron ? {} : { RAMU_DESKTOP_APP: process.execPath }
const xml = (text: string) =>
  text.replace(/[<>&"']/g, (s) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[s]!)
export function loginService(userData: string, daemonPath: string, enabled: boolean): void {
  if (process.platform !== 'darwin') throw new Error('Login startup is currently supported on macOS')
  const label = `app.ramu.background.${createHash('sha256').update(userData).digest('hex').slice(0, 12)}`
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
  const env = {
    RAMU_SUPERVISOR: '1',
    ELECTRON_RUN_AS_NODE: '1',
    RAMU_APP_VERSION: runtimeVersion(daemonPath),
    RAMU_USER_DATA: userData,
    RAMU_SOCKET: runtimeSocket(userData),
    ...desktopApp(),
    PATH: process.env.PATH ?? '/usr/bin:/bin:/opt/homebrew/bin',
    ...(process.env.RAMU_WORKTREES ? { RAMU_WORKTREES: process.env.RAMU_WORKTREES } : {}),
  }
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
  if (process.platform !== 'darwin') return
  const label = `app.ramu.background.${createHash('sha256').update(userData).digest('hex').slice(0, 12)}`
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
  const suffix = createHash('sha256').update(userData).digest('hex').slice(0, 12)
  return existsSync(join(homedir(), 'Library', 'LaunchAgents', `app.ramu.background.${suffix}.plist`))
}
