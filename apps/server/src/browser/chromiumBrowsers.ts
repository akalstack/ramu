/**
 * The Chromium browsers sign-ins can be imported from, with where each keeps its profiles and its "Safe Storage"
 * secret. They share Chrome's cookie format; only these locations differ. Windows keeps their cookies app-bound
 * encrypted, so it lists Chrome and Edge only to say why they cannot be imported.
 */
export const CHROMIUM_BROWSERS = {
  chrome: {
    name: 'Google Chrome',
    mac: {
      apps: ['Google Chrome.app'],
      data: 'Google/Chrome',
      keychain: { service: 'Chrome Safe Storage', account: 'Chrome' },
    },
    linux: {
      data: ['.config/google-chrome', '.config/chromium'],
      keyring: ['chrome', 'chromium'],
      bins: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    },
    windows: ['Google/Chrome/Application/chrome.exe'],
  },
  edge: {
    name: 'Microsoft Edge',
    mac: {
      apps: ['Microsoft Edge.app'],
      data: 'Microsoft Edge',
      keychain: { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' },
    },
    linux: { data: ['.config/microsoft-edge'], keyring: ['microsoft-edge'], bins: ['/usr/bin/microsoft-edge'] },
    windows: ['Microsoft/Edge/Application/msedge.exe'],
  },
  brave: {
    name: 'Brave',
    mac: {
      apps: ['Brave Browser.app'],
      data: 'BraveSoftware/Brave-Browser',
      keychain: { service: 'Brave Safe Storage', account: 'Brave' },
    },
    linux: {
      data: ['.config/BraveSoftware/Brave-Browser', 'snap/brave/current/.config/BraveSoftware/Brave-Browser'],
      keyring: ['brave'],
      bins: ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave'],
    },
  },
  vivaldi: {
    name: 'Vivaldi',
    mac: { apps: ['Vivaldi.app'], data: 'Vivaldi', keychain: { service: 'Vivaldi Safe Storage', account: 'Vivaldi' } },
    linux: { data: ['.config/vivaldi'], keyring: ['vivaldi'], bins: ['/usr/bin/vivaldi', '/usr/bin/vivaldi-stable'] },
  },
  arc: {
    name: 'Arc',
    mac: { apps: ['Arc.app'], data: 'Arc/User Data', keychain: { service: 'Arc Safe Storage', account: 'Arc' } },
  },
} as const satisfies Record<
  string,
  {
    name: string
    mac: { apps: readonly string[]; data: string; keychain: { service: string; account: string } }
    linux?: { data: readonly string[]; keyring: readonly string[]; bins: readonly string[] }
    windows?: readonly string[]
  }
>

export type ChromiumBrowserId = keyof typeof CHROMIUM_BROWSERS
export const CHROMIUM_BROWSER_IDS = Object.keys(CHROMIUM_BROWSERS) as ChromiumBrowserId[]
export const IMPORT_SOURCE_IDS = [...CHROMIUM_BROWSER_IDS, 'firefox'] as const
export type ImportSourceId = (typeof IMPORT_SOURCE_IDS)[number]

/** The browser's Linux locations, when it ships for Linux. */
export const linuxOf = (id: ChromiumBrowserId) =>
  (
    CHROMIUM_BROWSERS[id] as {
      linux?: { data: readonly string[]; keyring: readonly string[]; bins: readonly string[] }
    }
  ).linux
export const windowsOf = (id: ChromiumBrowserId) => (CHROMIUM_BROWSERS[id] as { windows?: readonly string[] }).windows
