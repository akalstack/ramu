import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArtifactApps, desktopEntry, ico, icns, infoPlist } from '../src/main/artifactApps'

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {}, shell: {} }))

const png = (size: number) => Buffer.from(`png${size}`)
const trip = { hostId: 'local', artifactId: 'a1', title: 'Trip costs', icon: '🧳' }

function system(platform: NodeJS.Platform) {
  const root = mkdtempSync(join(tmpdir(), 'ramu-apps-'))
  const shortcuts: { path: string; args: string; target: string }[] = []
  const apps = new ArtifactApps({
    platform,
    home: join(root, 'home'),
    userData: join(root, 'data'),
    dataHome: join(root, 'share'),
    command: { executable: '/opt/Ramu/ramu', args: [] },
    writeShortcut: (path, options) => shortcuts.push({ path, ...options }),
  })
  return { root, apps, shortcuts }
}

describe('ArtifactApps', () => {
  it('makes a macOS app that opens the artifact link, with its icon, and lists it', () => {
    const { root, apps } = system('darwin')
    apps.install(trip, png)
    const bundle = join(root, 'home', 'Applications', 'Ramu Apps', 'Trip costs.app', 'Contents')
    expect(readFileSync(join(bundle, 'MacOS', 'launcher'), 'utf8')).toContain("open 'ramu://artifact/local/a1'")
    expect(statSync(join(bundle, 'MacOS', 'launcher')).mode & 0o111).toBeTruthy()
    expect(readFileSync(join(bundle, 'Info.plist'), 'utf8')).toContain('<string>Trip costs</string>')
    expect(
      readFileSync(join(bundle, 'Resources', 'app.icns'))
        .subarray(0, 4)
        .toString(),
    ).toBe('icns')
    expect(apps.list()).toEqual([trip])
    expect(apps.installed('local', 'a1')).toBe(true)
  })

  it('moves the launcher when the artifact is renamed, and removes everything on uninstall', () => {
    const { root, apps } = system('darwin')
    apps.install(trip, png)
    apps.install({ ...trip, title: 'Trip budget', icon: '✈️' }, png)
    const folder = join(root, 'home', 'Applications', 'Ramu Apps')
    expect(readdirSync(folder)).toEqual(['Trip budget.app'])
    expect(apps.list()).toEqual([{ ...trip, title: 'Trip budget', icon: '✈️' }])
    apps.remove('local', 'a1')
    expect(readdirSync(folder)).toEqual([])
    expect(existsSync(apps.iconFile('local', 'a1', 'png'))).toBe(false)
    expect(apps.list()).toEqual([])
  })

  it('adds a Start menu shortcut on Windows with its own app id and icon', () => {
    const { root, apps, shortcuts } = system('win32')
    apps.install(trip, png)
    expect(shortcuts).toEqual([
      expect.objectContaining({
        path: join(root, 'share', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Ramu Apps', 'Trip costs.lnk'),
        target: '/opt/Ramu/ramu',
        args: '"ramu://artifact/local/a1"',
        icon: apps.iconFile('local', 'a1', 'ico'),
      }),
    ])
  })

  it('writes a Linux desktop entry and keeps titles out of other lines and paths', () => {
    const { root, apps } = system('linux')
    apps.install({ ...trip, title: 'Trip\nExec=evil ../../x' }, png)
    const [entry] = readdirSync(join(root, 'share', 'applications'))
    const text = readFileSync(join(root, 'share', 'applications', entry!), 'utf8')
    expect(text).toContain('Name=Trip Exec=evil ../../x\n')
    expect(text).toContain('Exec="/opt/Ramu/ramu" "ramu://artifact/local/a1"\n')
    expect(text.match(/^Exec=/gm)).toHaveLength(1)
  })

  it('refuses an artifact id that is not one', () => {
    const { apps } = system('linux')
    expect(() => apps.install({ ...trip, artifactId: '../../etc' }, png)).toThrow()
  })
})

describe('launcher files', () => {
  it('escapes a title in the plist and percent signs in a desktop entry', () => {
    expect(infoPlist({ ...trip, title: 'A & <B>' }, 'run.ramu.app.x')).toContain('A &amp; &lt;B&gt;')
    expect(desktopEntry(trip, ['/r', 'ramu://artifact/my%20host/a1'], '/i.png')).toContain(
      '"ramu://artifact/my%%20host/a1"',
    )
  })

  it('packs PNGs into icon files the systems read', () => {
    const apple = icns([{ type: 'ic09', png: Buffer.from('abc') }])
    expect(apple.readUInt32BE(4)).toBe(apple.length)
    expect(apple.subarray(8, 12).toString()).toBe('ic09')
    const windows = ico(Buffer.from('abc'))
    expect(windows.readUInt16LE(4)).toBe(1)
    expect(windows.readUInt32LE(14)).toBe(3)
    expect(windows.subarray(22).toString()).toBe('abc')
  })

  it('keeps a quote in a host id inside the launcher’s one argument', () => {
    const { root, apps } = system('darwin')
    apps.install({ ...trip, hostId: "x';touch pwned;'" }, png)
    const launcher = join(root, 'home', 'Applications', 'Ramu Apps', 'Trip costs.app', 'Contents', 'MacOS', 'launcher')
    // The shell reads the whole link as one word: echo it instead of opening it.
    const script = readFileSync(launcher, 'utf8').replace('exec /usr/bin/open', 'printf %s')
    const out = execFileSync('/bin/sh', ['-c', script], { cwd: root }).toString()
    expect(out).toBe("ramu://artifact/x'%3Btouch%20pwned%3B'/a1")
    expect(existsSync(join(root, 'pwned'))).toBe(false)
  })

  it('never deletes a saved launcher path outside Ramu’s own folders', () => {
    const { root, apps } = system('linux')
    apps.install(trip, png)
    const precious = join(root, 'precious')
    mkdirSync(precious)
    const file = join(root, 'data', 'artifact-apps.json')
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { launcher: string }[]
    writeFileSync(file, JSON.stringify(saved.map((app) => ({ ...app, launcher: precious }))))
    apps.remove('local', 'a1')
    expect(existsSync(precious)).toBe(true)
  })
})

it('remembers which picture an installed app was drawn from', () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-apps-'))
  const apps = new ArtifactApps({
    platform: 'linux',
    home: root,
    userData: join(root, 'data'),
    dataHome: join(root, 'share'),
    command: { executable: '/r', args: [] },
  })
  apps.install({ ...trip, appIcon: 1234 }, png)
  expect(apps.list()).toEqual([{ ...trip, appIcon: 1234 }])
})
