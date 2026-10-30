import { expect, it } from 'vitest'
import { browserUserAgent, browserUserAgentMetadata } from '../src/browserIdentity'

it('presents headless and embedded Chromium as plain Chromium', () => {
  expect(
    browserUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36',
    ),
  ).toBe(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.37 Safari/537.36',
  )
  expect(
    browserUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ramu/0.1.0-alpha.1 Chrome/142.0.7444.52 Electron/44.7.0 Safari/537.36',
    ),
  ).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.52 Safari/537.36')
})

it('reports client hints without a headless brand', () => {
  const hints = browserUserAgentMetadata('… Chrome/141.0.7390.37 Safari/537.36', 'darwin', 'arm64')
  expect(hints).toMatchObject({ fullVersion: '141.0.7390.37', platform: 'macOS', architecture: 'arm', mobile: false })
  expect(hints.brands.map((entry) => entry.brand)).toEqual(['Chromium', 'Not/A)Brand'])
})
