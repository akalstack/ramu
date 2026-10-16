import { expect, it } from 'vitest'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import { inResetSection, resetSection } from '../src/settings/resetDefaults'

const other = (value: 'auto' | 'off' | 'review') => (value === 'off' ? 'auto' : 'off')

const changed = (): AppPreferences => ({
  ...DEFAULT_APP_PREFERENCES,
  warnModelChange: !DEFAULT_APP_PREFERENCES.warnModelChange,
  keepAwake: !DEFAULT_APP_PREFERENCES.keepAwake,
  intelligence: {
    ...DEFAULT_APP_PREFERENCES.intelligence,
    compression: 'aggressive' as const,
    learning: other(DEFAULT_APP_PREFERENCES.intelligence.learning),
    crossThreadRecall: false,
    toolAwareSkills: false,
  },
})

it('resets only the preferences a section owns', () => {
  const next = resetSection(changed(), 'chats')
  expect(next.warnModelChange).toBe(DEFAULT_APP_PREFERENCES.warnModelChange)
  expect(next.keepAwake).toBe(!DEFAULT_APP_PREFERENCES.keepAwake)
})

it('splits the intelligence preferences between Threads and Memory', () => {
  const chats = resetSection(changed(), 'chats')
  expect(chats.intelligence.compression).toBe(DEFAULT_APP_PREFERENCES.intelligence.compression)
  expect(chats.intelligence.learning).toBe(other(DEFAULT_APP_PREFERENCES.intelligence.learning))
  expect(chats.intelligence.crossThreadRecall).toBe(false)
  expect(chats.intelligence.toolAwareSkills).toBe(false)
  const memory = resetSection(changed(), 'memory')
  expect(memory.intelligence.learning).toBe(DEFAULT_APP_PREFERENCES.intelligence.learning)
  expect(memory.intelligence.compression).toBe('aggressive')
  expect(memory.intelligence.crossThreadRecall).toBe(true)
  expect(memory.intelligence.toolAwareSkills).toBe(true)
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
  expect(inResetSection('chats', 'intelligence.compression')).toBe(true)
  expect(inResetSection('chats', 'intelligence.learning')).toBe(false)
  expect(inResetSection('memory', 'memory.enabled')).toBe(true)
  expect(inResetSection('memory', 'intelligence.crossThreadRecall')).toBe(true)
  expect(inResetSection('memory', 'intelligence.toolAwareSkills')).toBe(true)
  expect(inResetSection('memory', 'memoryExtra')).toBe(false)
  expect(inResetSection('shortcuts', 'warnModelChange')).toBe(false)
})
