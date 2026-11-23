import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { commandTarget, launcher, shellProfile, terminalCommand } from '../src/main/terminalCommand'

let home = ''
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ramu-command-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const app = { executable: '/Applications/Ramu.app/Contents/MacOS/Ramu', cli: '/Applications/Ramu.app/out/main/cli.js' }
const command = (
  shellPath: string | null,
  shell = '/bin/zsh',
  target: Parameters<typeof terminalCommand>[0]['target'] = app,
) =>
  terminalCommand({
    target,
    userData: "/Users/me/Library/Application Support/Ramu's",
    home,
    platform: 'darwin',
    env: { SHELL: shell },
    shellPath: async () => shellPath,
  })

it('offers the command only from an installed app that stays where it is', () => {
  const base = { ...app, platform: 'darwin' as const, env: {}, development: false }
  expect(commandTarget(base)).toEqual(app)
  expect(commandTarget({ ...base, development: true })).toEqual({ unavailable: 'development' })
  expect(commandTarget({ ...base, platform: 'win32' })).toEqual({ unavailable: 'platform' })
  expect(commandTarget({ ...base, platform: 'linux', env: { APPIMAGE: '/home/me/Ramu.AppImage' } })).toEqual({
    unavailable: 'appimage',
  })
  expect(
    commandTarget({ ...base, executable: '/private/var/folders/x/AppTranslocation/1/d/Ramu.app/Contents/MacOS/Ramu' }),
  ).toEqual({ unavailable: 'translocated' })
})

it('runs the app as Node with the arguments and quoting intact, on this app’s profile unless one is set', () => {
  const root = mkdtempSync(join(tmpdir(), "ramu app's-"))
  try {
    // A stand-in for the app's executable that prints what it was started with. Not "Ramu": on a case-insensitive
    // disk that is the launcher's own file.
    const executable = join(root, 'app-runtime')
    writeFileSync(
      executable,
      '#!/bin/sh\nprintf "%s|%s|%s|%s\\n" "$ELECTRON_RUN_AS_NODE" "$RAMU_TERMINAL_COMMAND" "$RAMU_USER_DATA" "$*"\n',
      { mode: 0o755 },
    )
    const script = join(root, 'ramu')
    writeFileSync(script, launcher({ executable, cli: join(root, 'cli.js') }, "/data/it's mine"), { mode: 0o755 })
    const env = { PATH: process.env.PATH ?? '' }
    expect(execFileSync(script, ['pair', '--json'], { env, encoding: 'utf8' })).toBe(
      `1|1|/data/it's mine|${join(root, 'cli.js')} pair --json\n`,
    )
    expect(execFileSync(script, ['status'], { env: { ...env, RAMU_USER_DATA: '/other' }, encoding: 'utf8' })).toBe(
      `1|1|/other|${join(root, 'cli.js')} status\n`,
    )
    rmSync(executable)
    expect(() => execFileSync(script, [], { env, stdio: 'pipe' })).toThrow(/no longer at/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('installs into ~/.local/bin and adds that folder to the shell profile once', async () => {
  const ramu = command(null)
  expect(await ramu.status()).toMatchObject({ installed: false, taken: false, onPath: false })
  const installed = await ramu.install()
  expect(installed).toMatchObject({ installed: true, onPath: true, path: join(home, '.local', 'bin', 'ramu') })
  expect(statSync(installed.path).mode & 0o777).toBe(0o755)
  await ramu.install()
  const profile = readFileSync(join(home, '.zshrc'), 'utf8')
  expect(profile.match(/\.local\/bin/g)).toHaveLength(1)
  expect(profile).toContain('export PATH="$HOME/.local/bin:$PATH"')
})

it('leaves the profile alone when terminals already find the folder', async () => {
  const ramu = command(`/usr/bin:${join(home, '.local', 'bin')}`)
  expect(await ramu.install()).toMatchObject({ installed: true, onPath: true })
  expect(() => readFileSync(join(home, '.zshrc'))).toThrow()
})

it('says when it cannot add the folder for an unknown shell', async () => {
  expect(await command(null, '/bin/tcsh').install()).toMatchObject({ installed: true, onPath: false })
})

it('never replaces or removes another program’s ramu', async () => {
  const path = join(home, '.local', 'bin', 'ramu')
  mkdirSync(join(home, '.local', 'bin'), { recursive: true })
  writeFileSync(path, '#!/bin/sh\necho someone else\n')
  const ramu = command(null)
  expect(await ramu.status()).toMatchObject({ installed: false, taken: true })
  await expect(ramu.install()).rejects.toThrow(/another program/)
  expect(await ramu.remove()).toMatchObject({ taken: true })
  expect(readFileSync(path, 'utf8')).toContain('someone else')
})

it('removes its own command, and follows the app when it moves', async () => {
  const ramu = command(null)
  const { path } = await ramu.install()
  command(null, '/bin/zsh', { executable: '/Applications/Moved/Ramu.app/Contents/MacOS/Ramu', cli: app.cli }).refresh()
  expect(readFileSync(path, 'utf8')).toContain("app='/Applications/Moved/Ramu.app/Contents/MacOS/Ramu'")
  expect(await ramu.remove()).toMatchObject({ installed: false, taken: false })
})

it('picks the startup file each shell reads', () => {
  expect(shellProfile('/bin/zsh', '/h', 'darwin', { ZDOTDIR: '/z' })?.path).toBe('/z/.zshrc')
  expect(shellProfile('/bin/bash', '/h', 'darwin', {})?.path).toBe('/h/.bash_profile')
  expect(shellProfile('/bin/bash', '/h', 'linux', {})?.path).toBe('/h/.bashrc')
  expect(shellProfile('/usr/bin/fish', '/h', 'linux', {})).toEqual({
    path: '/h/.config/fish/conf.d/ramu.fish',
    line: 'fish_add_path -g $HOME/.local/bin',
  })
  expect(shellProfile(undefined, '/h', 'linux', {})).toBeNull()
})
