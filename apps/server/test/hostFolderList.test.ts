import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HostFolders } from '../src/remote/hostFolders'

let root: string
let outside: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-list-')))
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-outside-')))
  process.env.RAMU_BROWSE_ROOTS = root
})
afterEach(() => {
  delete process.env.RAMU_BROWSE_ROOTS
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

it('lists sorted visible folders, marks repositories and leaves out files, hidden folders and escapes', async () => {
  for (const name of ['zeta', 'alpha', '.cache']) mkdirSync(join(root, name))
  mkdirSync(join(root, 'alpha', '.git'))
  writeFileSync(join(root, 'notes.txt'), '')
  symlinkSync(outside, join(root, 'escape'))
  // Many folders are looked at together, and every one still comes back.
  for (let index = 0; index < 40; index++) mkdirSync(join(root, `many-${String(index).padStart(2, '0')}`))

  const listing = await new HostFolders(() => []).list(root)

  expect(listing.path).toBe(root)
  expect(listing.parent).toBeNull()
  const names = listing.folders.map((folder) => folder.name)
  expect(names.slice(0, 2)).toEqual(['alpha', 'many-00'])
  expect(names.at(-1)).toBe('zeta')
  expect(names).toHaveLength(42)
  expect(names).not.toContain('.cache')
  expect(names).not.toContain('escape')
  expect(listing.folders.find((folder) => folder.name === 'alpha')?.repo).toBe(true)
  expect(listing.folders.find((folder) => folder.name === 'zeta')?.repo).toBe(false)
})

it('keeps folder calls inside RAMU_BROWSE_ROOTS, and lists only the places inside them', async () => {
  mkdirSync(join(root, 'app'))
  const folders = new HostFolders(() => [join(root, 'app')])
  await expect(folders.list(outside)).rejects.toThrow('outside the host browse roots')
  expect(await folders.places()).toEqual([{ kind: 'project', name: 'app', path: join(root, 'app') }])
})

describe('without browse roots', () => {
  beforeEach(() => {
    delete process.env.RAMU_BROWSE_ROOTS
  })

  it('opens any folder the host can read and steps up to the filesystem root', async () => {
    const listing = await new HostFolders(() => []).list(outside)
    expect(listing.path).toBe(outside)
    expect(listing.parent).toBe(dirname(outside))
    expect(listing.system).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('marks the root as a system folder with nothing above it', async () => {
    const listing = await new HostFolders(() => []).list('/')
    expect(listing.parent).toBeNull()
    expect(listing.system).toBe(true)
  })

  it('reads ~ as the home folder and says what is wrong with a typed path', async () => {
    writeFileSync(join(outside, 'notes.txt'), '')
    const folders = new HostFolders(() => [])
    expect((await folders.list('~')).path).toBe(realpathSync(homedir()))
    await expect(folders.list(join(outside, 'missing'))).rejects.toThrow('There is no folder at')
    await expect(folders.list(join(outside, 'notes.txt'))).rejects.toThrow('is a file, not a folder')
    await expect(folders.list('code/app')).rejects.toThrow('Choose an absolute host folder path')
  })

  it('starts from home and the computer, then project folders, each listed once', async () => {
    mkdirSync(join(outside, 'app'))
    const places = await new HostFolders(() => [
      join(outside, 'app'),
      join(outside, 'app'),
      join(outside, 'gone'),
    ]).places()
    expect(places[0]).toEqual({ kind: 'home', name: expect.any(String), path: realpathSync(homedir()) })
    if (process.platform !== 'win32')
      expect(places.some((place) => place.kind === 'computer' && place.path === '/')).toBe(true)
    expect(places.filter((place) => place.kind === 'project')).toEqual([
      { kind: 'project', name: 'app', path: join(outside, 'app') },
    ])
  })
})
