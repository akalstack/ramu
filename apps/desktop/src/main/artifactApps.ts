import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { z } from 'zod'
import { artifactLink, type InstalledArtifactApp } from '@ramu/shared/artifacts'

/**
 * Artifacts installed as apps: a launcher in the system's own app list (Applications on macOS, the Start menu on
 * Windows, the applications menu on Linux) that opens `ramu://artifact/<host>/<id>`, which Ramu shows in the artifact's
 * own window. The launcher holds only the link, so it always opens the newest version.
 */

const appSchema = z.object({
  hostId: z.string().min(1).max(120),
  artifactId: z.string().regex(/^[\w-]{1,80}$/),
  title: z.string().trim().min(1).max(200),
  icon: z.string().min(1).max(32),
  appIcon: z.number().int().positive().optional(),
})
const savedSchema = z.array(appSchema.extend({ launcher: z.string().max(4096) })).max(500)
type SavedApp = z.infer<typeof savedSchema>[number]

/** The parts of the system an install writes to, so tests can point them at a folder. */
export interface ArtifactAppSystem {
  platform: NodeJS.Platform
  home: string
  /** Where Ramu keeps its own files: the installed list and the icons a launcher points at. */
  userData: string
  /** `%APPDATA%` on Windows, `$XDG_DATA_HOME` (or `~/.local/share`) on Linux. */
  dataHome: string
  /** The command that opens a link in this Ramu: its executable and the arguments before the link. */
  command: { executable: string; args: string[] }
  /** Writes a Windows shortcut. */
  writeShortcut?(path: string, options: { target: string; args: string; icon: string; appUserModelId: string }): void
}

const key = (hostId: string, artifactId: string) => `${hostId}\n${artifactId}`
/** A stable id for one installed app, used in file names and as its system app id. */
export const artifactAppId = (hostId: string, artifactId: string) =>
  createHash('sha256').update(key(hostId, artifactId)).digest('hex').slice(0, 16)

/** A title as a file name every platform accepts, without leading dots. */
const fileName = (title: string) =>
  title
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80) || 'Artifact'

/** One shell word, whatever it holds. */
const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

const xml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'))

/** An Apple icon file holding PNGs, which macOS reads at every size it draws. */
export function icns(pngs: { type: 'ic07' | 'ic08' | 'ic09' | 'ic10'; png: Buffer }[]): Buffer {
  const entries = pngs.map(({ type, png }) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4)
  return Buffer.concat([header, ...entries])
}

/** A Windows icon file holding one 256 px PNG, which Windows scales for every place it shows. */
export function ico(png: Buffer): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  // Width and height 0 mean 256.
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

/** An argument for a Linux desktop entry's Exec line: quoted, with `%` doubled as the spec asks. */
const execArg = (text: string) => `"${text.replace(/[\\"`$]/g, (c) => `\\${c}`).replace(/%/g, '%%')}"`

export function desktopEntry(app: InstalledArtifactApp, command: string[], icon: string): string {
  const line = (text: string) => text.replace(/[\r\n]/g, ' ')
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${line(app.title)}`,
    'Comment=Ramu artifact',
    `Exec=${command.map(execArg).join(' ')}`,
    `Icon=${line(icon)}`,
    'Terminal=false',
    'Categories=Utility;',
    '',
  ].join('\n')
}

export function infoPlist(app: InstalledArtifactApp, bundleId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleName</key><string>${xml(app.title)}</string>
  <key>CFBundleDisplayName</key><string>${xml(app.title)}</string>
  <key>CFBundleIconFile</key><string>app.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`
}

export class ArtifactApps {
  constructor(private readonly system: ArtifactAppSystem) {}

  private get file() {
    return join(this.system.userData, 'artifact-apps.json')
  }

  /** Where an installed app's icons live in Ramu's own folder, for its window and a Linux launcher. */
  iconFile(hostId: string, artifactId: string, extension: 'png' | 'ico') {
    return join(this.system.userData, 'artifact-apps', `${artifactAppId(hostId, artifactId)}.${extension}`)
  }

  private read(): SavedApp[] {
    try {
      return existsSync(this.file) ? savedSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))) : []
    } catch {
      return []
    }
  }

  private write(apps: SavedApp[]) {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(apps, null, 2))
  }

  list(): InstalledArtifactApp[] {
    return this.read().map(({ launcher: _launcher, ...app }) => app)
  }

  installed(hostId: string, artifactId: string): boolean {
    return this.read().some((app) => key(app.hostId, app.artifactId) === key(hostId, artifactId))
  }

  /** Adds the launcher, or rewrites it after a rename or a new icon; an old launcher under another name goes away. */
  install(input: unknown, iconAt: (size: number) => Buffer): InstalledArtifactApp {
    const app = appSchema.parse(input)
    const apps = this.read()
    const previous = apps.find((saved) => key(saved.hostId, saved.artifactId) === key(app.hostId, app.artifactId))
    const launcher = this.writeLauncher(app, iconAt)
    if (previous && previous.launcher !== launcher && this.ownLauncher(previous.launcher))
      rmSync(previous.launcher, { recursive: true, force: true })
    this.write([...apps.filter((saved) => saved !== previous), { ...app, launcher }])
    return app
  }

  /** Launchers live only where Ramu writes them; a saved path anywhere else is never deleted. */
  private ownLauncher(path: string): boolean {
    const { home, dataHome } = this.system
    return [
      join(home, 'Applications', 'Ramu Apps'),
      join(dataHome, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Ramu Apps'),
      join(dataHome, 'applications'),
    ].some((root) => {
      const rel = relative(root, path)
      return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
    })
  }

  remove(hostId: string, artifactId: string) {
    const apps = this.read()
    const gone = apps.filter((saved) => key(saved.hostId, saved.artifactId) === key(hostId, artifactId))
    for (const app of gone) if (this.ownLauncher(app.launcher)) rmSync(app.launcher, { recursive: true, force: true })
    rmSync(this.iconFile(hostId, artifactId, 'png'), { force: true })
    rmSync(this.iconFile(hostId, artifactId, 'ico'), { force: true })
    this.write(apps.filter((saved) => !gone.includes(saved)))
  }

  private writeLauncher(app: InstalledArtifactApp, iconAt: (size: number) => Buffer): string {
    const { platform, home, dataHome, command } = this.system
    const link = artifactLink({ computerId: app.hostId, artifactId: app.artifactId })
    const id = artifactAppId(app.hostId, app.artifactId)
    const png = this.iconFile(app.hostId, app.artifactId, 'png')
    mkdirSync(dirname(png), { recursive: true })
    writeFileSync(png, iconAt(256))
    if (platform === 'darwin') {
      const bundle = join(home, 'Applications', 'Ramu Apps', `${fileName(app.title)}.app`)
      const contents = join(bundle, 'Contents')
      mkdirSync(join(contents, 'MacOS'), { recursive: true })
      mkdirSync(join(contents, 'Resources'), { recursive: true })
      writeFileSync(join(contents, 'Info.plist'), infoPlist(app, `run.ramu.app.${id}`))
      writeFileSync(
        join(contents, 'Resources', 'app.icns'),
        icns([
          { type: 'ic07', png: iconAt(128) },
          { type: 'ic08', png: iconAt(256) },
          { type: 'ic09', png: iconAt(512) },
        ]),
      )
      // Percent-encoding leaves `'` as it is, so the link is quoted for the shell; `open` hands it to the running Ramu.
      writeFileSync(join(contents, 'MacOS', 'launcher'), `#!/bin/sh\nexec /usr/bin/open ${shellQuote(link)}\n`, {
        mode: 0o755,
      })
      // Finder and the Dock read a bundle's icon again once its date changes.
      const now = new Date()
      utimesSync(bundle, now, now)
      return bundle
    }
    if (platform === 'win32') {
      const icon = this.iconFile(app.hostId, app.artifactId, 'ico')
      writeFileSync(icon, ico(iconAt(256)))
      const shortcut = join(
        dataHome,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'Ramu Apps',
        `${fileName(app.title)}.lnk`,
      )
      mkdirSync(dirname(shortcut), { recursive: true })
      if (!this.system.writeShortcut) throw new Error('Shortcuts cannot be made here.')
      this.system.writeShortcut(shortcut, {
        target: command.executable,
        args: [...command.args, link].map((arg) => `"${arg}"`).join(' '),
        icon,
        appUserModelId: `run.ramu.app.${id}`,
      })
      return shortcut
    }
    const entry = join(dataHome, 'applications', `ramu-app-${id}.desktop`)
    mkdirSync(dirname(entry), { recursive: true })
    writeFileSync(entry, desktopEntry(app, [command.executable, ...command.args, link], png), {
      mode: 0o755,
    })
    return entry
  }
}
