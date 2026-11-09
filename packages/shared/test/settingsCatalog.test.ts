import { expect, it } from 'vitest'
import { SETTINGS_CATALOG, catalogEntryFor, findSettingsEntries } from '../src/settingsCatalog'
import { SETTINGS_MENU } from '../src/settingsMenu'

const label = (section: string) => SETTINGS_MENU.find((entry) => entry.id === section)!.label

it('names each setting on one row only, so a change card and search point at the same place', () => {
  const paths = SETTINGS_CATALOG.flatMap((entry) => (entry.path ? [entry.path] : []))
  expect(new Set(paths).size).toBe(paths.length)
  expect(catalogEntryFor('warnModelChange')).toMatchObject({ section: 'chats', title: 'Warn before changing model' })
})

it('finds rows by every word of the query, title matches first', () => {
  expect(findSettingsEntries('warn model', label)[0]).toMatchObject({ path: 'warnModelChange' })
  expect(findSettingsEntries('commit style', label)[0]).toMatchObject({ path: 'commitStyle' })
  expect(findSettingsEntries('remote pair', label).map((entry) => entry.title)).toContain('Pair a device')
  expect(findSettingsEntries('   ', label)).toEqual([])
})
