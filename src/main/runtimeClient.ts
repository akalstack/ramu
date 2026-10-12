import { request } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync, readdirSync, cpSync, renameSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'

export function runtimeSocket(userData: string): string {
  return join(tmpdir(), `ramu-${process.getuid?.() ?? 'user'}-${createHash('sha256').update(userData).digest('hex').slice(0, 20)}.sock`)
}
export function runtimeInvoke(socketPath: string, method: string, args: unknown[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/invoke', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c)); res.on('error', reject)
      res.on('end', () => { try { const body = JSON.parse(Buffer.concat(chunks).toString()); body.error ? reject(new Error(body.error)) : resolve(body.value) } catch (e) { reject(e) } })
    })
    req.on('error', reject); req.setTimeout(180000, () => req.destroy(new Error('Background service request timed out')))
    req.end(JSON.stringify({ method, args }, (_key, value) => value === undefined ? { '$ramuUndefined': true } : value))
  })
}
/** Identifies the daemon code on disk, so a service left running from an older build can be told apart from the current one. */
export function runtimeBuild(daemonPath: string): string {
  try {
    const hash = createHash('sha256')
    // Include shared Vite chunks as well as the entry point; timestamps aren't a version.
    for (const name of readdirSync(dirname(daemonPath)).filter((name) => name.endsWith('.js')).sort()) hash.update(name).update(readFileSync(join(dirname(daemonPath), name)))
    return hash.digest('hex').slice(0, 20)
  } catch { return 'unknown' }
}
export function runtimeVersion(daemonPath: string): string { try { return JSON.parse(readFileSync(join(dirname(daemonPath), '../../package.json'), 'utf8')).version } catch { return process.env.RAMU_APP_VERSION ?? 'development' } }
/** A packaged daemon must not lazy-load code from an app bundle being updated. */
export function pinnedRuntime(userData: string, daemonPath: string, executable = process.execPath) {
  if (process.platform !== 'darwin' || !executable.includes('.app/Contents/MacOS/')) return { daemonPath, executable }
  const bundle = executable.slice(0, executable.indexOf('.app/Contents/MacOS/') + 4)
  const destination = join(userData, 'background-runtimes', runtimeBuild(daemonPath), 'Ramu.app')
  if (!existsSync(destination)) {
    const temporary = `${destination}.partial`
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    rmSync(temporary, { recursive: true, force: true })
    cpSync(bundle, temporary, { recursive: true, dereference: false })
    renameSync(temporary, destination)
  }
  return { daemonPath: join(destination, relative(bundle, daemonPath)), executable: join(destination, relative(bundle, executable)) }
}
export async function ensureRuntime(userData: string, daemonPath: string, executable = process.execPath): Promise<string> {
  mkdirSync(userData, { recursive: true })
  const socketPath = runtimeSocket(userData)
  try {
    const status = await runtimeInvoke(socketPath, 'background.status')
    // A version mismatch is shown to the user. App launch/restart never replaces
    // a healthy service, because it may own running chats.
    if (status?.running) return socketPath
  } catch (error) {
    if (!['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
  try { unlinkSync(join(userData, 'background.stopped')) } catch {}
  try { unlinkSync(socketPath) } catch {}
  const log = openSync(join(userData, 'background.log'), 'a', 0o600)
  const pinned = pinnedRuntime(userData, daemonPath, executable)
  const child = spawn(pinned.executable, [pinned.daemonPath], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', RAMU_APP_VERSION: runtimeVersion(daemonPath), RAMU_USER_DATA: userData, RAMU_SOCKET: socketPath } })
  child.on('error', () => {}); child.unref(); closeSync(log)
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    try { await runtimeInvoke(socketPath, 'background.status'); return socketPath } catch {}
  }
  throw new Error(`Background service could not start. See ${join(userData, 'background.log')}`)
}
const xml = (text: string) => text.replace(/[<>&"']/g, (s) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[s]!))
export function loginService(userData: string, daemonPath: string, enabled: boolean): void {
  if (process.platform !== 'darwin') throw new Error('Login startup is currently supported on macOS')
  const label = `app.ramu.background.${createHash('sha256').update(userData).digest('hex').slice(0, 12)}`
  const dir = join(homedir(), 'Library', 'LaunchAgents'), path = join(dir, `${label}.plist`), domain = `gui/${process.getuid!()}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(userData, 'background-startup.json'), JSON.stringify(enabled))
  if (!enabled) { try { execFileSync('/bin/launchctl', ['disable', `${domain}/${label}`], { stdio: 'ignore' }) } catch {}; try { unlinkSync(path) } catch {}; return }
  const pinned = pinnedRuntime(userData, daemonPath)
  const env = { RAMU_SUPERVISOR: '1', ELECTRON_RUN_AS_NODE: '1', RAMU_APP_VERSION: runtimeVersion(daemonPath), RAMU_USER_DATA: userData, RAMU_SOCKET: runtimeSocket(userData), PATH: process.env.PATH ?? '/usr/bin:/bin:/opt/homebrew/bin', ...(process.env.RAMU_WORKTREES ? { RAMU_WORKTREES: process.env.RAMU_WORKTREES } : {}) }
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(pinned.executable)}</string><string>${xml(pinned.daemonPath)}</string></array><key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join('')}</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>StandardOutPath</key><string>${xml(join(userData, 'background.log'))}</string><key>StandardErrorPath</key><string>${xml(join(userData, 'background.log'))}</string></dict></plist>`, { mode: 0o600 })
  execFileSync('/bin/launchctl', ['enable', `${domain}/${label}`], { stdio: 'ignore' })
  try { execFileSync('/bin/launchctl', ['bootstrap', domain, path], { stdio: 'ignore' }) } catch (error) { try { execFileSync('/bin/launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }) } catch { throw error } }
  try { execFileSync('/bin/launchctl', ['kickstart', `${domain}/${label}`], { stdio: 'ignore' }) } catch {}
}
export function unloadLoginService(userData: string) {
  if (process.platform !== 'darwin') return
  const label = `app.ramu.background.${createHash('sha256').update(userData).digest('hex').slice(0, 12)}`
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid!()}/${label}`], { stdio: 'ignore' }) } catch {}
}
export function loginPreferred(userData: string): boolean | null { try { return JSON.parse(readFileSync(join(userData, 'background-startup.json'), 'utf8')) === true } catch { return null } }
export function loginEnabled(userData: string): boolean {
  const suffix = createHash('sha256').update(userData).digest('hex').slice(0, 12)
  return existsSync(join(homedir(), 'Library', 'LaunchAgents', `app.ramu.background.${suffix}.plist`))
}
export function subscribeRuntime(socketPath: string, receive: (channel: string, payload: any) => void): () => void {
  let closed = false, retry: NodeJS.Timeout | undefined, active: ReturnType<typeof request> | undefined
  const connect = () => {
    if (closed) return
    active = request({ socketPath, path: '/events', method: 'GET' }, (res) => {
      receive('background:connection', { connected: true })
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        buffer += chunk
        for (;;) { const i = buffer.indexOf('\n\n'); if (i < 0) break; const line = buffer.slice(0, i); buffer = buffer.slice(i + 2); if (!line.startsWith('data: ')) continue; try { const event = JSON.parse(line.slice(6)); receive(event.channel, event.payload) } catch {} }
      })
      res.on('end', disconnected); res.on('error', disconnected)
    })
    const disconnected = () => { if (closed || retry) return; receive('background:connection', { connected: false }); retry = setTimeout(() => { retry = undefined; connect() }, 1000) }
    active.on('error', disconnected); active.end()
  }
  connect()
  return () => { closed = true; clearTimeout(retry); active?.destroy() }
}
