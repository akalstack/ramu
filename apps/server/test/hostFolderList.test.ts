import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
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
