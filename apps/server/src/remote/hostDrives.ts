import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { HostPlace } from '@ramu/shared/workspace/hostFolders'

/** The most drives one host lists, and how long one may take to answer before it is left out. */
const MAX_DRIVES = 32
const DRIVE_MS = 1500

export const withDeadline = <T>(work: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms)
    work.then(resolve, reject).finally(() => clearTimeout(timer))
  })

/** The filesystem reads drive detection needs, so it can be checked against a made-up computer. */
export interface DriveSource {
  platform: string
  readdir(path: string): Promise<string[]>
  realpath(path: string): Promise<string>
  readFile(path: string): Promise<string>
  isDirectory(path: string): Promise<boolean>
}

const systemSource = (): DriveSource => ({
  platform: process.platform,
  readdir: (path) => readdir(path),
  realpath: (path) => realpath(path),
  readFile: (path) => readFile(path, 'utf8'),
  isDirectory: (path) => stat(path).then((info) => info.isDirectory()),
})

// APFS mounts its own helper volumes under /Volumes on some Macs; none of them holds a person's work.
const MAC_SYSTEM_VOLUMES = new Set(['Recovery', 'Preboot', 'VM', 'Update', 'xarts', 'iSCPreboot', 'Hardware'])
// Mount points people keep drives on. WSL's own plumbing sits under /mnt too.
const LINUX_DRIVE_PARENTS = ['/media/', '/run/media/', '/mnt/']
const LINUX_SKIPPED = new Set(['/mnt/wsl', '/mnt/wslg'])
// An automounter answers a look at its folder by mounting, which can stall on an absent network share.
const LINUX_SKIPPED_TYPES = new Set(['autofs', 'tmpfs', 'proc', 'sysfs', 'devpts', 'cgroup', 'cgroup2'])

/** `/proc/mounts` writes spaces, tabs and backslashes in a mount point as octal escapes. */
const unescapeMount = (path: string) =>
  path.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))

async function macDrives(source: DriveSource): Promise<{ boot: string | null; drives: HostPlace[] }> {
  const names = await source.readdir('/Volumes').catch(() => [])
  let boot: string | null = null
  const drives: HostPlace[] = []
  await Promise.all(
    names
      .filter((name) => !name.startsWith('.') && !name.startsWith('com.apple.') && !MAC_SYSTEM_VOLUMES.has(name))
      .map(async (name) => {
        const path = join('/Volumes', name)
        const real = await withDeadline(source.realpath(path), DRIVE_MS).catch(() => null)
        // The boot volume appears here as a link to `/`; it is the computer itself, not another drive.
        if (real === '/') boot = name
        else if (real) drives.push({ kind: 'drive', name, path: real })
      }),
  )
  return { boot, drives }
}

async function linuxDrives(source: DriveSource): Promise<HostPlace[]> {
  const mounts = await source.readFile('/proc/self/mounts').catch(() => '')
  const points = new Set<string>()
  for (const line of mounts.split('\n')) {
    const [, rawPoint, type] = line.split(' ')
    if (!rawPoint || !type || LINUX_SKIPPED_TYPES.has(type)) continue
    const point = unescapeMount(rawPoint)
    if (LINUX_DRIVE_PARENTS.some((parent) => point.startsWith(parent)) && !LINUX_SKIPPED.has(point)) points.add(point)
  }
  return [...points].map((path) => ({ kind: 'drive', name: basename(path), path }))
}

async function windowsDrives(source: DriveSource): Promise<HostPlace[]> {
  const letters = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))
  const found = await Promise.all(
    letters.map((letter) =>
      withDeadline(source.isDirectory(`${letter}:\\`), DRIVE_MS).then(
        (present) => (present ? letter : null),
        () => null,
      ),
    ),
  )
  return found.flatMap((letter) =>
    letter ? [{ kind: 'drive' as const, name: `${letter}:`, path: `${letter}:\\` }] : [],
  )
}

/**
 * The computer's root and its mounted drives, sorted by name. macOS: the volumes in `/Volumes` but the boot volume,
 * whose name the root takes. Linux: filesystems mounted under `/media`, `/run/media` and `/mnt`. Windows: each drive
 * letter, and no separate root.
 */
export async function hostDrives(source: DriveSource = systemSource()): Promise<HostPlace[]> {
  const byName = (a: HostPlace, b: HostPlace) => a.name.localeCompare(b.name)
  if (source.platform === 'win32') return (await windowsDrives(source)).slice(0, MAX_DRIVES)
  if (source.platform === 'darwin') {
    const { boot, drives } = await macDrives(source)
    return [{ kind: 'computer', name: boot ?? '/', path: '/' }, ...drives.sort(byName).slice(0, MAX_DRIVES)]
  }
  const drives = source.platform === 'linux' ? await linuxDrives(source) : []
  return [{ kind: 'computer', name: '/', path: '/' }, ...drives.sort(byName).slice(0, MAX_DRIVES)]
}
