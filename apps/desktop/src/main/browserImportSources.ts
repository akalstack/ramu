import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserImportSource } from '@ramu/shared/types/browser'

/** Discovery reads executable presence only. No source profiles, cookies or keychain values are opened. */
export function browserImportSources(platform = process.platform, env = process.env, exists = existsSync): BrowserImportSource[] {
  const paths: Record<string, { name: string; paths: string[] }> = platform === 'darwin' ? {
    chrome: { name: 'Google Chrome', paths: ['/Applications/Google Chrome.app', join(env.HOME ?? '', 'Applications/Google Chrome.app')] },
    edge: { name: 'Microsoft Edge', paths: ['/Applications/Microsoft Edge.app'] },
    firefox: { name: 'Firefox', paths: ['/Applications/Firefox.app'] },
    safari: { name: 'Safari', paths: ['/Applications/Safari.app', '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app'] },
  } : platform === 'win32' ? {
    chrome: { name: 'Google Chrome', paths: [join(env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'), join(env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')] },
    edge: { name: 'Microsoft Edge', paths: [join(env['PROGRAMFILES(X86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe')] },
    firefox: { name: 'Firefox', paths: [join(env.PROGRAMFILES ?? '', 'Mozilla Firefox/firefox.exe')] },
  } : {
    chrome: { name: 'Google Chrome', paths: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'] },
    edge: { name: 'Microsoft Edge', paths: ['/usr/bin/microsoft-edge'] },
    firefox: { name: 'Firefox', paths: ['/usr/bin/firefox', '/snap/bin/firefox'] },
  }
  return Object.entries(paths).map(([id, browser]) => ({
    id, name: browser.name, installed: browser.paths.some(path => exists(path)),
    // macOS Chrome, Edge and Firefox are the verified sources. Everything else says why not and offers manual sign-in.
    supported: platform === 'darwin' && (id === 'chrome' || id === 'edge' || id === 'firefox'),
    ...(platform === 'darwin' && (id === 'chrome' || id === 'edge' || id === 'firefox') ? {} : { reason:
      platform === 'win32' && (id === 'chrome' || id === 'edge')
        ? 'Import from Windows Chromium browsers is unavailable because their protected credentials are not supported. Sign in to a Ramu profile instead.'
        : id === 'safari'
          ? 'Safari keeps its cookies where only apps with Full Disk Access can read them. Sign in to a Ramu profile instead.'
          : 'Session import from this browser is not available yet. Sign in to a Ramu profile instead.' }),
  }))
}
