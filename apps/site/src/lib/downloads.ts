// The desktop downloads getramu.dev offers. `/download/<id>` always means the newest release's file of that kind, so
// the page links stay put while the files come from GitHub Releases, where each release's assets are uploaded.

export type DownloadId =
  | 'mac-arm64'
  | 'mac-x64'
  | 'linux-x64-deb'
  | 'linux-x64-rpm'
  | 'linux-x64-appimage'
  | 'linux-arm64-deb'
  | 'linux-arm64-rpm'
  | 'linux-arm64-appimage'

export interface Download {
  id: DownloadId
  os: 'mac' | 'linux'
  /** The computer it is for, as the page names it. */
  label: string
  /** The kind of file, as the page names it. */
  kind: string
  /** The release asset's name, as `pnpm release:assets` writes it, for any version. */
  asset: RegExp
}

export const DOWNLOADS: Download[] = [
  {
    id: 'mac-arm64',
    os: 'mac',
    label: 'macOS · Apple silicon',
    kind: 'DMG',
    asset: /^darwin-arm64-Ramu-.+-arm64\.dmg$/,
  },
  { id: 'mac-x64', os: 'mac', label: 'macOS · Intel', kind: 'DMG', asset: /^darwin-x64-Ramu-.+-x64\.dmg$/ },
  { id: 'linux-x64-deb', os: 'linux', label: 'Linux · x64', kind: '.deb', asset: /^linux-x64-ramu_.+_amd64\.deb$/ },
  { id: 'linux-x64-rpm', os: 'linux', label: 'Linux · x64', kind: '.rpm', asset: /^linux-x64-ramu-.+\.x86_64\.rpm$/ },
  {
    id: 'linux-x64-appimage',
    os: 'linux',
    label: 'Linux · x64',
    kind: 'AppImage',
    asset: /^linux-x64-Ramu-.+-x64\.AppImage$/,
  },
  {
    id: 'linux-arm64-deb',
    os: 'linux',
    label: 'Linux · arm64',
    kind: '.deb',
    asset: /^linux-arm64-ramu_.+_arm64\.deb$/,
  },
  {
    id: 'linux-arm64-rpm',
    os: 'linux',
    label: 'Linux · arm64',
    kind: '.rpm',
    asset: /^linux-arm64-ramu-.+\.arm64\.rpm$/,
  },
  {
    id: 'linux-arm64-appimage',
    os: 'linux',
    label: 'Linux · arm64',
    kind: 'AppImage',
    asset: /^linux-arm64-Ramu-.+-arm64\.AppImage$/,
  },
]

export const downloadPath = (id: DownloadId) => `/download/${id}`

export interface Release {
  draft: boolean
  assets: { name: string; browser_download_url: string }[]
}

/**
 * The file to send for `/download/<id>`: from the newest published release that has it, pre-releases included, since
 * every desktop release so far is an alpha. Null for an unknown id or when no release has the file.
 */
export function downloadUrl(id: string, releases: Release[]): string | null {
  const download = DOWNLOADS.find((entry) => entry.id === id)
  if (!download) return null
  for (const release of releases) {
    if (release.draft) continue
    const asset = release.assets.find((entry) => download.asset.test(entry.name))
    if (asset) return asset.browser_download_url
  }
  return null
}

export interface Visitor {
  userAgent: string
  /** `navigator.userAgentData.platform`, where the browser offers it. */
  platform?: string
  /** `navigator.userAgentData` architecture hint: `arm` or `x86`, where the browser offers it. */
  architecture?: string
  /** `navigator.userAgentData.mobile`, where the browser offers it. */
  mobile?: boolean
}

export type Suggestion = { kind: 'download'; id: DownloadId } | { kind: 'windows' } | { kind: 'phone' } | null

/**
 * The download to offer first. Safari reports every Mac as Intel, so a Mac without an architecture hint gets Apple
 * silicon, which current Macs are; Intel stays one link away. Linux gets the package its distribution installs, or
 * the AppImage, which runs on any.
 */
export function suggestDownload(visitor: Visitor): Suggestion {
  const agent = visitor.userAgent
  if (visitor.mobile || /iPhone|iPad|iPod|Android/i.test(agent)) return { kind: 'phone' }
  const platform = visitor.platform ?? ''
  if (/Windows/i.test(platform) || /Windows NT/i.test(agent)) return { kind: 'windows' }
  if (/mac/i.test(platform) || /Macintosh|Mac OS X/i.test(agent))
    return { kind: 'download', id: visitor.architecture === 'x86' ? 'mac-x64' : 'mac-arm64' }
  if (/Linux/i.test(platform) || /Linux|X11/i.test(agent)) {
    const arm = visitor.architecture === 'arm' || /aarch64|arm64|armv8/i.test(agent)
    const cpu = arm ? 'arm64' : 'x64'
    const format = /Ubuntu|Debian|Mint/i.test(agent)
      ? 'deb'
      : /Fedora|Red Hat|CentOS|openSUSE/i.test(agent)
        ? 'rpm'
        : 'appimage'
    return { kind: 'download', id: `linux-${cpu}-${format}` }
  }
  return null
}
