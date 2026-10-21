import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserProfiles, type BrowserProfileFiles } from '../src/main/browserProfiles'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const missing = () => {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' })
}

it('keeps stable profile identity across rename and disk reopening, with only non-secret metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-browser-profiles-'))
  directories.push(directory)
  const path = join(directory, 'profiles.json')
  const profiles = new BrowserProfiles(path)
  const created = profiles.create('Work')
  profiles.rename(created.id, 'Work account')
  const reopened = new BrowserProfiles(path)
  expect(reopened.catalog().profiles.find((profile) => profile.id === created.id)).toMatchObject({
    name: 'Work account',
    builtin: false,
  })
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
    version: 1,
    profiles: [{ id: created.id, name: 'Work account', createdAt: created.createdAt }],
  })
  expect(reopened.ids()).toEqual([created.id])
})

it('bounds and validates names and identities and preserves built-ins', () => {
  const profiles = new BrowserProfiles('profiles', { read: missing, write() {} })
  expect(profiles.catalog().profiles.map((profile) => profile.id)).toEqual(['default', 'temporary'])
  for (const bad of ['', 'a'.repeat(81), '\u202eWork', 'Work\nOther']) expect(() => profiles.create(bad)).toThrow()
  const work = profiles.create('Work')
  expect(() => profiles.create('work')).toThrow('already uses')
  expect(() => profiles.create('Default')).toThrow('already uses')
  for (const id of ['default', 'temporary', '../escape', 'missing']) expect(() => profiles.remove(id)).toThrow()
  profiles.rename(work.id, 'Personal')
  for (let index = 0; index < 19; index++) profiles.create(`Profile ${index}`)
  expect(() => profiles.create('Too many')).toThrow('Remove a browser profile')
})

it('never overwrites a corrupt catalog or publishes a failed metadata write', () => {
  const write = vi.fn()
  const damaged = new BrowserProfiles('profiles', { read: () => '{"version":1,"profiles":[{"id":"default"}]}', write })
  expect(damaged.catalog().error).toContain('could not be read')
  expect(() => damaged.create('New')).toThrow('Restore the profile catalog')
  expect(write).not.toHaveBeenCalled()
  const storage: BrowserProfileFiles = {
    read: missing,
    write: () => {
      throw new Error('disk full')
    },
  }
  const profiles = new BrowserProfiles('profiles', storage)
  expect(() => profiles.create('New')).toThrow('disk full')
  expect(profiles.ids()).toEqual([])
})

it('locks profile administration across runtime contexts and releases the lock after failure', async () => {
  const profiles = new BrowserProfiles('profiles', { read: missing, write() {} })
  const work = profiles.create('Work')
  let finish!: () => void
  const operation = profiles.withLock(
    work.id,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  expect(profiles.isBusy(work.id)).toBe(true)
  expect(() => profiles.rename(work.id, 'Other')).toThrow('already being changed')
  await expect(profiles.withLock(work.id, async () => {})).rejects.toThrow('already being changed')
  finish()
  await operation
  expect(profiles.isBusy(work.id)).toBe(false)
  await expect(
    profiles.withLock(work.id, async () => {
      throw new Error('clear failed')
    }),
  ).rejects.toThrow('clear failed')
  expect(profiles.isBusy(work.id)).toBe(false)
})
