import { expect, it } from 'vitest'
import { SETTINGS_MENU } from '@ramu/shared/settingsMenu'
import { searchSettings } from '../src/settings/settingsSearch'

const label = (section: string) => SETTINGS_MENU.find((entry) => entry.id === section)!.label
const first = (query: string, translate = (text: string) => text) => searchSettings(query, translate, label)[0]

it('opens the page that owns each moved setting in one step', () => {
  expect(first('simulator')).toMatchObject({ kind: 'page', section: 'devices' })
  expect(first('emulator')).toMatchObject({ kind: 'page', section: 'devices' })
  expect(first('environment')).toMatchObject({ kind: 'page', section: 'agent-setup', title: 'Environment variables' })
  expect(first('fallback')).toMatchObject({ kind: 'page', section: 'models' })
  expect(first('export settings')).toMatchObject({ kind: 'page', section: 'account', title: 'Copy settings' })
})

it('finds archived threads as the sidebar view, not a settings page', () => {
  expect(first('archived')).toMatchObject({ kind: 'view', view: 'archived', title: 'Archived threads' })
})

it('matches translated titles and names the page each result is on', () => {
  const id = (text: string) => (text === 'Let agents use test devices' ? 'Izinkan agent memakai perangkat uji' : text)
  const hit = first('perangkat uji', id)
  expect(hit).toMatchObject({ kind: 'page', section: 'devices', label: 'Test devices' })
  expect(hit?.title).toBe('Izinkan agent memakai perangkat uji')
  expect(searchSettings('   ', id, label)).toEqual([])
})

it('only points at pages the menu has', () => {
  const sections = new Set<string>(SETTINGS_MENU.map((entry) => entry.id))
  for (const result of searchSettings('e', (text) => text, label))
    if (result.kind === 'page') expect(sections.has(result.section)).toBe(true)
})
