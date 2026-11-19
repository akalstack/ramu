import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOWNLOADS, downloadUrl, suggestDownload, type Release } from '../src/lib/downloads.ts'

// The asset names v0.1.0-alpha.1 was published with.
const ALPHA = [
  'darwin-arm64-Ramu-0.1.0-alpha.1-arm64.dmg',
  'darwin-arm64-Ramu-darwin-arm64-0.1.0-alpha.1.zip',
  'darwin-x64-Ramu-0.1.0-alpha.1-x64.dmg',
  'darwin-x64-Ramu-darwin-x64-0.1.0-alpha.1.zip',
  'linux-arm64-Ramu-0.1.0-alpha.1-arm64.AppImage',
  'linux-arm64-ramu-0.1.0.alpha.1-1.arm64.rpm',
  'linux-arm64-Ramu-linux-arm64-0.1.0-alpha.1.zip',
  'linux-arm64-ramu_0.1.0.alpha.1_arm64.deb',
  'linux-x64-Ramu-0.1.0-alpha.1-x64.AppImage',
  'linux-x64-ramu-0.1.0.alpha.1-1.x86_64.rpm',
  'linux-x64-Ramu-linux-x64-0.1.0-alpha.1.zip',
  'linux-x64-ramu_0.1.0.alpha.1_amd64.deb',
  'SHA256SUMS-darwin-arm64.txt',
]
const release = (tag: string, names: string[], draft = false): Release => ({
  draft,
  assets: names.map((name) => ({ name, browser_download_url: `https://github.test/${tag}/${name}` })),
})

test('every download matches exactly one installer of the published release, never a ZIP or checksum', () => {
  for (const download of DOWNLOADS) {
    const matches = ALPHA.filter((name) => download.asset.test(name))
    assert.equal(matches.length, 1, download.id)
    assert.doesNotMatch(matches[0]!, /\.zip$|SHA256/)
  }
})

test('a download comes from the newest published release that has it, skipping drafts', () => {
  const releases = [
    release(
      'v0.2.0-alpha.1',
      ALPHA.map((name) => name.replaceAll('0.1.0', '0.2.0')),
      true,
    ),
    release('v0.1.1', ['darwin-arm64-Ramu-0.1.1-arm64.dmg']),
    release('v0.1.0-alpha.1', ALPHA),
  ]
  assert.equal(downloadUrl('mac-arm64', releases), 'https://github.test/v0.1.1/darwin-arm64-Ramu-0.1.1-arm64.dmg')
  assert.equal(
    downloadUrl('linux-x64-deb', releases),
    'https://github.test/v0.1.0-alpha.1/linux-x64-ramu_0.1.0.alpha.1_amd64.deb',
  )
  assert.equal(downloadUrl('windows-x64', releases), null)
  assert.equal(downloadUrl('mac-x64', []), null)
})

test('the first download offered follows the visitor’s computer', () => {
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15'
  // Safari says Intel on every Mac, so without a hint Apple silicon comes first.
  assert.deepEqual(suggestDownload({ userAgent: mac }), { kind: 'download', id: 'mac-arm64' })
  assert.deepEqual(suggestDownload({ userAgent: mac, platform: 'macOS', architecture: 'x86' }), {
    kind: 'download',
    id: 'mac-x64',
  })
  assert.deepEqual(suggestDownload({ userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Firefox/140.0' }), {
    kind: 'download',
    id: 'linux-x64-deb',
  })
  assert.deepEqual(suggestDownload({ userAgent: 'Mozilla/5.0 (X11; Fedora; Linux aarch64; rv:140.0) Firefox/140.0' }), {
    kind: 'download',
    id: 'linux-arm64-rpm',
  })
  assert.deepEqual(suggestDownload({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0' }), {
    kind: 'download',
    id: 'linux-x64-appimage',
  })
  assert.deepEqual(suggestDownload({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), { kind: 'windows' })
  assert.deepEqual(suggestDownload({ userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10) Mobile' }), {
    kind: 'phone',
  })
  assert.deepEqual(suggestDownload({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)' }), {
    kind: 'phone',
  })
  assert.equal(suggestDownload({ userAgent: 'curl/8.0' }), null)
})
