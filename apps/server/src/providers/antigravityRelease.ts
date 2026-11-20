import { existsSync } from 'node:fs'

/** Google's release feed for the Antigravity CLI: one manifest per platform, naming the newest build and its SHA-512. */
export const ANTIGRAVITY_MANIFESTS = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests'
const DOWNLOAD_PREFIX = 'https://storage.googleapis.com/antigravity-public/antigravity-cli/'

export interface AntigravityAsset {
  version: string
  url: string
  sha512: string
  /** macOS and Linux builds come as a gzipped tar holding one executable; Windows builds are the executable itself. */
  format: 'tar.gz' | 'executable'
}

const musl = (arch: string) =>
  existsSync(arch === 'arm64' ? '/lib/libc.musl-aarch64.so.1' : '/lib/libc.musl-x86_64.so.1')

/** The manifest name for a platform, or null where Google publishes no CLI. */
export function antigravityTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  isMusl = platform === 'linux' && musl(arch),
): string | null {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) return null
  return `${platform === 'win32' ? 'windows' : platform}_${arch === 'x64' ? 'amd64' : 'arm64'}${platform === 'linux' && isMusl ? '_musl' : ''}`
}

/** The build a manifest names for this platform. Only Google's own download folder, plain versions and a SHA-512 are trusted. */
export function resolveAntigravityAsset(
  manifest: unknown,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  isMusl = platform === 'linux' && musl(arch),
): AntigravityAsset | null {
  const entry = manifest as { version?: unknown; url?: unknown; sha512?: unknown } | null
  const { version, url, sha512 } = entry ?? {}
  if (!antigravityTarget(platform, arch, isMusl)) return null
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return null
  if (typeof sha512 !== 'string' || !/^[0-9a-f]{128}$/i.test(sha512)) return null
  if (typeof url !== 'string' || !url.startsWith(`${DOWNLOAD_PREFIX}${version}-`)) return null
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux'
  const suffix = platform === 'linux' && isMusl ? '_musl' : ''
  const folder = `${platform === 'win32' ? 'windows' : platform}-${arch === 'arm64' ? 'arm' : 'x64'}${suffix ? '-musl' : ''}`
  const file = `${folder}/cli_${os}_${arch === 'arm64' ? 'arm64' : 'x64'}${suffix}.${platform === 'win32' ? 'exe' : 'tar.gz'}`
  const rest = url.slice(`${DOWNLOAD_PREFIX}${version}-`.length)
  if (!/^\d+\//.test(rest) || rest.replace(/^\d+\//, '') !== file) return null
  return {
    version,
    url,
    sha512: sha512.toLowerCase(),
    format: platform === 'win32' ? 'executable' : 'tar.gz',
  }
}
