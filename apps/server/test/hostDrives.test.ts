import { expect, it } from 'vitest'
import { hostDrives, type DriveSource } from '../src/remote/hostDrives'

const source = (
  platform: string,
  files: { dirs?: Record<string, string[]>; links?: Record<string, string> } & Partial<DriveSource> = {},
): DriveSource => ({
  platform,
  readdir: async (path) => {
    const found = files.dirs?.[path]
    if (!found) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return found
  },
  realpath: async (path) => files.links?.[path] ?? path,
  readFile: async () => {
    throw new Error('missing')
  },
  isDirectory: async () => false,
  ...files,
})

it('lists a Mac’s volumes, naming the root after the boot volume and leaving out system volumes', async () => {
  const drives = await hostDrives(
    source('darwin', {
      dirs: {
        '/Volumes': [
          'Macintosh HD',
          'Drive',
          'Backup Disk',
          'Recovery',
          '.timemachine',
          'com.apple.TimeMachine.localsnapshots',
        ],
      },
      links: { '/Volumes/Macintosh HD': '/' },
    }),
  )
  expect(drives).toEqual([
    { kind: 'computer', name: 'Macintosh HD', path: '/' },
    { kind: 'drive', name: 'Backup Disk', path: '/Volumes/Backup Disk' },
    { kind: 'drive', name: 'Drive', path: '/Volumes/Drive' },
  ])
})

it('leaves out a Mac volume that does not answer in time', async () => {
  const drives = await hostDrives(
    source('darwin', {
      dirs: { '/Volumes': ['Share'] },
      realpath: (path) => (path === '/Volumes/Share' ? new Promise(() => {}) : Promise.resolve(path)),
    }),
  )
  expect(drives).toEqual([{ kind: 'computer', name: '/', path: '/' }])
}, 5000)

it('lists filesystems mounted under /media, /run/media and /mnt on Linux, but not the system’s own', async () => {
  const mounts = [
    '/dev/sda2 / ext4 rw 0 0',
    'proc /proc proc rw 0 0',
    '/dev/sdb1 /media/ana/USB\\040Stick vfat rw 0 0',
    '/dev/sdc1 /run/media/ana/Photos exfat rw 0 0',
    'C:\\134 /mnt/c 9p rw 0 0',
    'none /mnt/wslg tmpfs rw 0 0',
    'none /mnt/wsl tmpfs rw 0 0',
    'auto /mnt/net autofs rw 0 0',
    'tmpfs /run/user/1000 tmpfs rw 0 0',
  ].join('\n')
  const drives = await hostDrives(source('linux', { readFile: async () => mounts }))
  expect(drives).toEqual([
    { kind: 'computer', name: '/', path: '/' },
    { kind: 'drive', name: 'c', path: '/mnt/c' },
    { kind: 'drive', name: 'Photos', path: '/run/media/ana/Photos' },
    { kind: 'drive', name: 'USB Stick', path: '/media/ana/USB Stick' },
  ])
})

it('lists each Windows drive letter that answers, with no separate root', async () => {
  const drives = await hostDrives(source('win32', { isDirectory: async (path) => path === 'C:\\' || path === 'E:\\' }))
  expect(drives).toEqual([
    { kind: 'drive', name: 'C:', path: 'C:\\' },
    { kind: 'drive', name: 'E:', path: 'E:\\' },
  ])
})
