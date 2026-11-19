import { expect, it, vi } from 'vitest'
import { browserImportSources } from '../src/browser/browserImportSources'

const installed =
  (...names: string[]) =>
  (path: unknown) =>
    names.some((name) => String(path).includes(name))

it('offers macOS Chrome, Edge and Firefox as supported when installed, and says why Safari is not', () => {
  const sources = browserImportSources('darwin', { HOME: '/Users/a' }, installed('Chrome', 'Firefox', 'Safari'))
  const byId = Object.fromEntries(sources.map((source) => [source.id, source]))
  expect(byId.chrome).toMatchObject({ installed: true, supported: true })
  expect(byId.firefox).toMatchObject({ installed: true, supported: true })
  expect(byId.edge).toMatchObject({ installed: false, supported: true })
  expect(byId.safari).toMatchObject({ installed: true, supported: false })
  expect(byId.safari!.reason).toMatch(/Full Disk Access/)
  expect(byId.chrome!.reason).toBeUndefined()
})

it('keeps Windows unsupported with a specific reason, supports Linux Chromium/Firefox, and reads no files', () => {
  const exists = vi.fn((_path: unknown) => true)
  const windows = browserImportSources('win32', {}, exists)
  // Only Firefox reads on Windows: its cookies are plain SQLite, while Chromium's are app-bound encrypted.
  expect(windows.filter((source) => source.supported).map((source) => source.id)).toEqual(['firefox'])
  expect(windows.find((source) => source.id === 'firefox')!.reason).toBeUndefined()
  expect(windows.find((source) => source.id === 'chrome')!.reason).toMatch(/credentials are protected/)
  const linux = browserImportSources('linux', {}, exists)
  expect(linux.every((source) => source.supported && !source.reason)).toBe(true)
  // Discovery only asks whether an app exists.
  expect(exists.mock.calls.every(([path]) => typeof path === 'string')).toBe(true)
})

it('lists Brave, Vivaldi and Arc where they ship, as importable as Chrome', () => {
  const mac = browserImportSources(
    'darwin',
    { HOME: '/Users/a' },
    installed('Brave Browser', 'Users/a/Applications/Arc'),
  )
  const byId = Object.fromEntries(mac.map((source) => [source.id, source]))
  expect(byId.brave).toMatchObject({ name: 'Brave', installed: true, supported: true })
  expect(byId.arc).toMatchObject({ name: 'Arc', installed: true, supported: true })
  expect(byId.vivaldi).toMatchObject({ installed: false, supported: true })
  const linux = browserImportSources('linux', {}, installed('/usr/bin/vivaldi'))
  expect(linux.map((source) => source.id)).toEqual(['chrome', 'edge', 'brave', 'vivaldi', 'firefox'])
  expect(linux.find((source) => source.id === 'vivaldi')).toMatchObject({ installed: true, supported: true })
  // Arc and Vivaldi have no Windows build to list; Chrome and Edge are listed to say why not.
  expect(browserImportSources('win32', {}, () => false).map((source) => source.id)).toEqual([
    'chrome',
    'edge',
    'firefox',
  ])
})
