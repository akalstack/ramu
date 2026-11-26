import { beforeEach, expect, it } from 'vitest'
import { portableSettings, type SettingEdit, type SettingsSnapshot } from '@ramu/shared/settingsCompatibility'
import { DEFAULT_APP_PREFERENCES, type AgentSessionInfo } from '@ramu/shared/types'
import { appPreferences, appPreferencesSchema } from '../src/ipc/preferences'
import { applySettingEdits } from '../src/sharedSettings'
import { SettingsChanges } from '../src/settings/settingsChanges'

let saved: ReturnType<typeof appPreferences.parse>
let state: Map<string, unknown>
let access: AgentSessionInfo['settings']['access']
let shown: string[]
let changes: SettingsChanges

const snapshot = async (): Promise<SettingsSnapshot> => ({
  protocol: 1,
  preferences: saved,
  catalogs: [],
  settings: portableSettings(appPreferencesSchema, saved as unknown as Record<string, unknown>),
  agentMarks: changes.marks(),
})
/** A save from Settings, as `settings.app.patch` does it: checked against `before`, and the person's own. */
const personSaves = async (path: string, value: unknown) => {
  const field = (await snapshot()).settings.find((entry) => entry.path === path)!
  await patch([{ path, schema: field.schema, before: field.value, value }])
}
const patch = async (edits: SettingEdit[]) => {
  saved = applySettingEdits(appPreferencesSchema, appPreferences, saved, edits)
  changes.personChanged(edits.map((edit) => edit.path))
  return snapshot()
}

beforeEach(() => {
  saved = appPreferences.parse(DEFAULT_APP_PREFERENCES)
  state = new Map()
  access = 'auto'
  shown = []
  changes = new SettingsChanges(
    {
      getAppState: <T>(key: string, fallback: T) => (state.has(key) ? (state.get(key) as T) : fallback),
      setAppState: (key, value) => void state.set(key, structuredClone(value)),
    },
    {
      get: () => ({ taskId: 'task', settings: { access } }) as AgentSessionInfo,
      settingsChangeShown: (_session, cardId) => void shown.push(cardId),
    },
    { snapshot, patch },
    () => 'Tidy settings',
    () => {},
  )
})

it('refuses settings only the person may change, and still finds them with the page to open', async () => {
  await expect(
    changes.request('session', [{ path: 'defaultAccess', value: 'full' }], 'Asked for Full access'),
  ).rejects.toThrow(/Only the person can change “Default access”.*Permissions/)
  await expect(changes.request('session', [{ path: 'agentThreads', value: false }], 'x')).rejects.toThrow(
    /Only the person/,
  )
  expect(shown).toEqual([])
  expect(saved.defaultAccess).toBe(DEFAULT_APP_PREFERENCES.defaultAccess)
  const found = await changes.find('default access')
  expect(found[0]).toMatchObject({ path: 'defaultAccess', change: 'yourself', page: 'Permissions' })
  expect((await changes.find('pair device'))[0]).toMatchObject({ title: 'Connect a device', change: 'yourself' })
  expect((await changes.find('warn model'))[0]).toMatchObject({
    path: 'warnModelChange',
    change: 'agent',
    current: true,
  })
})

it('refuses unknown settings and values the setting does not allow, changing nothing', async () => {
  await expect(changes.request('session', [{ path: 'sidebarWidth', value: 300 }], 'x')).rejects.toThrow(/settings_find/)
  await expect(changes.request('session', [{ path: 'recentChats', value: 99 }], 'x')).rejects.toThrow(
    /Nothing was changed/,
  )
  expect(shown).toEqual([])
})

it('waits for Apply outside Full access, then saves and marks the rows with the thread', async () => {
  const outcome = await changes.request(
    'session',
    [
      { path: 'warnModelChange', value: false },
      { path: 'recentChats', value: 12 },
    ],
    'You asked to stop the model warning',
  )
  expect(outcome).toMatchObject({ state: 'waiting' })
  expect(saved.warnModelChange).toBe(true)
  const card = await changes.apply(shown[0]!)
  expect(card.state).toBe('applied')
  expect(saved).toMatchObject({ warnModelChange: false, recentChats: 12 })
  expect(changes.marks().map((mark) => [mark.path, mark.thread])).toEqual([
    ['warnModelChange', 'Tidy settings'],
    ['recentChats', 'Tidy settings'],
  ])
  await personSaves('recentChats', 8)
  expect(changes.marks().map((mark) => mark.path)).toEqual(['warnModelChange'])
})

it('refuses Apply for a row that changed after the agent asked', async () => {
  await changes.request('session', [{ path: 'recentChats', value: 12 }], 'x')
  await personSaves('recentChats', 7)
  const card = await changes.apply(shown[0]!)
  expect(card).toMatchObject({ state: 'waiting', error: expect.stringMatching(/changed after the agent asked/) })
  expect(saved.recentChats).toBe(7)
})

it('applies at once in Full access, and Undo restores the values from before', async () => {
  access = 'full'
  const outcome = await changes.request('session', [{ path: 'warnModelChange', value: false }], 'x')
  expect(outcome).toMatchObject({ state: 'applied' })
  expect(saved.warnModelChange).toBe(false)
  const card = await changes.undo(shown[0]!)
  expect(card.state).toBe('undone')
  expect(saved.warnModelChange).toBe(true)
  expect(changes.marks()).toEqual([])
})

it('refuses Undo once the person changed the row, leaving their value', async () => {
  access = 'full'
  await changes.request('session', [{ path: 'recentChats', value: 12 }], 'x')
  await personSaves('recentChats', 15)
  const card = await changes.undo(shown[0]!)
  expect(card).toMatchObject({ state: 'applied', error: expect.stringMatching(/Open it in Settings/) })
  expect(saved.recentChats).toBe(15)
})
