import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserImportSource } from '@ramu/shared/types/browser'
import { CHROMIUM_BROWSERS, CHROMIUM_BROWSER_IDS, linuxOf, windowsOf } from './chromiumBrowsers'

const WINDOWS_CHROMIUM =
  'Importing from Chromium browsers on Windows is not supported, because their credentials are protected. Sign in to a Ramu profile instead.'
const SAFARI =
  'Safari keeps its cookies where only apps with Full Disk Access can read them. Sign in to a Ramu profile instead.'

/**
 * The browsers this host has, and whether sign-ins can be imported from each. Discovery reads executable presence
 * only; no source profiles, cookies or keychain values are opened. A browser that does not ship for this platform is
 * not listed.
 */
export function browserImportSources(
  platform = process.platform,
  env = process.env,
  exists = existsSync,
): BrowserImportSource[] {
  const entry = (id: string, name: string, paths: readonly string[], reason?: string): BrowserImportSource => ({
    id,
    name,
    installed: paths.some((path) => exists(path)),
    supported: !reason,
    ...(reason ? { reason } : {}),
  })
  if (platform === 'darwin') {
    const apps = (names: readonly string[]) =>
      names.flatMap((name) => [`/Applications/${name}`, join(env.HOME ?? '', 'Applications', name)])
    return [
      ...CHROMIUM_BROWSER_IDS.map((id) => entry(id, CHROMIUM_BROWSERS[id].name, apps(CHROMIUM_BROWSERS[id].mac.apps))),
      entry('firefox', 'Firefox', apps(['Firefox.app'])),
      entry(
        'safari',
        'Safari',
        ['/Applications/Safari.app', '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app'],
        SAFARI,
      ),
    ]
  }
  if (platform === 'win32')
    return [
      ...CHROMIUM_BROWSER_IDS.flatMap((id) => {
        const paths = windowsOf(id)
        return paths
          ? [
              entry(
                id,
                CHROMIUM_BROWSERS[id].name,
                paths.flatMap((path) => [
                  join(env.PROGRAMFILES ?? '', path),
                  join(env['PROGRAMFILES(X86)'] ?? '', path),
                  join(env.LOCALAPPDATA ?? '', path),
                ]),
                WINDOWS_CHROMIUM,
              ),
            ]
          : []
      }),
      entry('firefox', 'Firefox', [join(env.PROGRAMFILES ?? '', 'Mozilla Firefox/firefox.exe')]),
    ]
  return [
    ...CHROMIUM_BROWSER_IDS.flatMap((id) => {
      const linux = linuxOf(id)
      return linux ? [entry(id, CHROMIUM_BROWSERS[id].name, linux.bins)] : []
    }),
    entry('firefox', 'Firefox', ['/usr/bin/firefox', '/snap/bin/firefox']),
  ]
}
