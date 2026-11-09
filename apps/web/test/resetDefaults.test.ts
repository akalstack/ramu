import { expect, it } from 'vitest'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import { SETTINGS_CATALOG } from '@ramu/shared/settingsCatalog'
import { inResetSection, resetSection, resetSetting } from '../src/settings/resetDefaults'

const other = (value: 'auto' | 'off' | 'review') => (value === 'off' ? 'auto' : 'off')

const changed = (): AppPreferences => ({
  ...DEFAULT_APP_PREFERENCES,
  warnModelChange: !DEFAULT_APP_PREFERENCES.warnModelChange,
  keepAwake: !DEFAULT_APP_PREFERENCES.keepAwake,
  intelligence: {
    ...DEFAULT_APP_PREFERENCES.intelligence,
    learning: other(DEFAULT_APP_PREFERENCES.intelligence.learning),
    crossThreadRecall: false,
    toolSearch: !DEFAULT_APP_PREFERENCES.intelligence.toolSearch,
  },
})

it('resets only the preferences a section owns', () => {
  const next = resetSection(changed(), 'chats')
  expect(next.warnModelChange).toBe(DEFAULT_APP_PREFERENCES.warnModelChange)
  expect(next.keepAwake).toBe(!DEFAULT_APP_PREFERENCES.keepAwake)
})

it('splits the intelligence preferences between Threads and Memory', () => {
  const chats = resetSection(changed(), 'chats')
  expect(chats.intelligence.toolSearch).toBe(DEFAULT_APP_PREFERENCES.intelligence.toolSearch)
  expect(chats.intelligence.learning).toBe(other(DEFAULT_APP_PREFERENCES.intelligence.learning))
  expect(chats.intelligence.crossThreadRecall).toBe(false)
  const memory = resetSection(changed(), 'memory')
  expect(memory.intelligence.learning).toBe(DEFAULT_APP_PREFERENCES.intelligence.learning)
  expect(memory.intelligence.toolSearch).toBe(!DEFAULT_APP_PREFERENCES.intelligence.toolSearch)
  expect(memory.intelligence.crossThreadRecall).toBe(true)
})

it('leaves intelligence untouched for other sections', () => {
  const current = changed()
  expect(resetSection(current, 'system').intelligence).toBe(current.intelligence)
})

it('restores each provider binding to its defaults, keeping its other fields', () => {
  const provider = AGENT_PROVIDERS[0]!
  const current = changed()
  current.providerBinaries = {
    ...current.providerBinaries,
    [provider]: { ...current.providerBinaries[provider], binary: '/x/claude', accountId: 'work', enabled: false },
  }
  const next = resetSection(current, 'providers')
  expect(next.providerBinaries[provider]).toMatchObject({ binary: '', accountId: 'default', enabled: true })
})

it('matches setting paths to the section that resets them', () => {
  expect(resetSection({ ...changed(), autoWatchPullRequests: true }, 'git').autoWatchPullRequests).toBe(false)
  expect(inResetSection('git', 'autoWatchPullRequests')).toBe(true)
  expect(inResetSection('chats', 'warnModelChange')).toBe(true)
  expect(inResetSection('chats', 'intelligence.toolSearch')).toBe(true)
  expect(inResetSection('chats', 'intelligence.learning')).toBe(false)
  expect(inResetSection('memory', 'memory.enabled')).toBe(true)
  expect(inResetSection('memory', 'intelligence.crossThreadRecall')).toBe(true)
  expect(inResetSection('memory', 'memoryExtra')).toBe(false)
  expect(inResetSection('shortcuts', 'warnModelChange')).toBe(false)
})

it("lets each page's Reset to defaults reach every setting on that page", () => {
  // Model sets ($models) restore through their own Restore button.
  const unreached = SETTINGS_CATALOG.flatMap((entry) =>
    entry.path && !entry.path.startsWith('$') && !inResetSection(entry.section, entry.path)
      ? [`${entry.section}: ${entry.path}`]
      : [],
  )
  expect(unreached).toEqual([])
})

it('puts one setting back to the default its host advertises, leaving the rest of the draft alone', () => {
  const current = { ...changed(), memory: { ...DEFAULT_APP_PREFERENCES.memory, staleAfterDays: 30, dream: false } }
  const next = resetSetting(current, 'memory.staleAfterDays', { type: 'integer', default: 90 })
  expect(next.memory).toEqual({ ...current.memory, staleAfterDays: 90 })
  expect(next.warnModelChange).toBe(current.warnModelChange)
  expect(current.memory.staleAfterDays).toBe(30)
  // A setting whose schema names no default has nothing to put back.
  expect(resetSetting(current, 'memory.staleAfterDays', { type: 'integer' })).toBe(current)
})
