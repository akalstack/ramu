// Websites refuse or challenge browsers that announce automation: Chromium run headless names itself HeadlessChrome,
// and Electron adds its own and the app's product tokens, which sign-in pages such as Google's reject as an embedded
// browser. The integrated browser presents itself as the Chromium it is.

/** The user agent without the headless, Electron or app tokens. */
export function browserUserAgent(userAgent: string): string {
  return userAgent
    .replace(/HeadlessChrome\//g, 'Chrome/')
    .replace(/\s(?:Electron|ramu|Ramu)\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Client hints matching `browserUserAgent`, for runtimes that would otherwise report a headless brand. */
export function browserUserAgentMetadata(userAgent: string, platform: string, arch: string) {
  const full = /Chrome\/([\d.]+)/.exec(userAgent)?.[1] ?? '0.0.0.0'
  const major = full.split('.')[0]!
  return {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Not/A)Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: full },
      { brand: 'Not/A)Brand', version: '24.0.0.0' },
    ],
    fullVersion: full,
    platform: platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux',
    platformVersion: '',
    architecture: arch === 'arm64' ? 'arm' : 'x86',
    bitness: '64',
    model: '',
    mobile: false,
  }
}
