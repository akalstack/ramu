import { expect, it } from 'vitest'
import { deviceOsSchema, readHostOs } from '../src/remote/hostOs'

const files = (map: Record<string, string>) => (path: string) => map[path] ?? ''

it('reads what this host runs on from the files its OS keeps, without running anything', () => {
  expect(
    readHostOs(
      'darwin',
      {},
      files({
        '/System/Library/CoreServices/SystemVersion.plist':
          '<dict><key>ProductName</key><string>macOS</string><key>ProductVersion</key><string>26.1</string></dict>',
      }),
    ),
  ).toEqual({ os: 'macos', form: 'computer', version: '26.1' })
  const ubuntu = files({
    '/etc/os-release': 'NAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n',
  })
  // No display: a server; with one, a computer someone sits at.
  expect(readHostOs('linux', {}, ubuntu)).toEqual({
    os: 'linux',
    form: 'server',
    version: '24.04',
    distro: 'ubuntu',
    distroName: 'Ubuntu 24.04.1 LTS',
  })
  expect(readHostOs('linux', { WAYLAND_DISPLAY: 'wayland-0' }, ubuntu).form).toBe('computer')
  expect(readHostOs('linux', {}, files({}))).toEqual({ os: 'linux', form: 'server' })
  expect(readHostOs('freebsd', {}, files({}))).toEqual({ os: 'unknown', form: 'computer' })
})

it('accepts only a bounded description from a paired device', () => {
  expect(deviceOsSchema.safeParse({ os: 'ios', form: 'phone', version: '26.1', model: 'iPhone 17 Pro' }).success).toBe(
    true,
  )
  expect(deviceOsSchema.safeParse({ os: 'beos', form: 'phone' }).success).toBe(false)
  expect(deviceOsSchema.safeParse({ os: 'linux', form: 'server', distro: '../etc' }).success).toBe(false)
  expect(deviceOsSchema.safeParse({ os: 'ios', form: 'phone', model: 'x'.repeat(200) }).success).toBe(false)
})
