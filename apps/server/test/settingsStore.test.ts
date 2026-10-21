import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'

// These tests rely on the OS file-watch service, which can drop events when many test workers run at once.
const watched = (name: string, fn: () => unknown) => it(name, { retry: 2 }, fn)
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SettingsStore } from '../src/settings/settingsStore'

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})

function fixture(preferences: unknown = {}, models: unknown = null) {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-settings-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const db = openDb(join(directory, 'ramu.db'))
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, join(directory, 'worktrees'))
  workspace.setAppState('app-preferences', preferences)
  workspace.setAppState('model-preferences', models)
  const warn = vi.fn()
  const store = new SettingsStore(directory, { preferences, models }, warn)
  workspace.settingsStore = store
  cleanup.push(() => store.close())
  return { directory, db, workspace, store, warn }
}

const models = {
  defaultBarMode: 'effort',
  defaultSetId: 'set',
  defaultStepId: 'step',
  sets: [
    {
      id: 'set',
      name: 'My models',
      steps: [{ id: 'step', name: 'Coder', provider: 'codex', model: 'custom-model', effort: 'high' }],
    },
  ],
}

watched('migrates real SQLite preferences and models once, preserving the legacy archive and runtime state', () => {
  const f = fixture({ ...DEFAULT_APP_PREFERENCES, accent: 'teal', worktreeBranchPrefix: 'team/' }, models)
  f.workspace.setAppState('runtime-example', { active: true })
  const document = JSON.parse(readFileSync(f.store.path, 'utf8'))
  expect(document).toMatchObject({ accent: 'teal', worktreeBranchPrefix: 'team/', models })
  f.workspace.setAppState('app-preferences', { ...DEFAULT_APP_PREFERENCES, accent: 'violet' })
  expect(f.workspace.getAppState('app-preferences', {})).toMatchObject({ accent: 'violet' })
  const archive = f.db.prepare("SELECT value FROM app_state WHERE key = 'app-preferences'").get() as { value: string }
  expect(JSON.parse(archive.value)).toMatchObject({ accent: 'teal' })
  f.store.close()
  const restarted = new SettingsStore(f.directory, { preferences: { accent: 'blue' }, models: null })
  cleanup.push(() => restarted.close())
  expect(restarted.preferences().accent).toBe('violet')
  expect(restarted.models()).toEqual(models)
  expect(f.workspace.getAppState('runtime-example', null)).toEqual({ active: true })
})

watched('reflects external editor renames and notifies subscribers once per valid change', async () => {
  const f = fixture()
  const changed = vi.fn()
  f.store.subscribe(changed)
  writeFileSync(join(f.directory, 'editor.tmp'), JSON.stringify({ accent: 'teal', models }))
  renameSync(join(f.directory, 'editor.tmp'), f.store.path)
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1), { timeout: 5000 })
  expect(f.workspace.getAppState('app-preferences', {})).toMatchObject({ accent: 'teal' })
  expect(f.workspace.getAppState('model-preferences', null)).toEqual(models)
  f.store.reload()
  expect(changed).toHaveBeenCalledTimes(1)
  f.store.close()
  writeFileSync(f.store.path, JSON.stringify({ accent: 'violet' }))
  expect(changed).toHaveBeenCalledTimes(1)
})

watched('keeps last good settings on malformed or invalid edits and refuses to overwrite them', () => {
  const f = fixture({ accent: 'teal' })
  for (const invalid of ['{', '[]', '{"accent":"invalid"}', '{"models":{"sets":[]}}']) {
    writeFileSync(f.store.path, invalid)
    f.store.reload()
    expect(f.store.preferences().accent).toBe('teal')
    expect(() => f.store.set({ accent: 'blue' })).toThrow()
    expect(readFileSync(f.store.path, 'utf8')).toBe(invalid)
  }
  expect(f.warn).toHaveBeenCalled()
  f.store.close()
  const restarted = new SettingsStore(f.directory, { preferences: { accent: 'teal' }, models: null }, f.warn)
  cleanup.push(() => restarted.close())
  expect(restarted.preferences()).toEqual(DEFAULT_APP_PREFERENCES)
  expect(readFileSync(restarted.path, 'utf8')).toBe('{"models":{"sets":[]}}')
})

watched('validates a combined preference/model save before replacing the file and preserves external fields', () => {
  const f = fixture()
  const original = readFileSync(f.store.path, 'utf8')
  expect(() => f.store.set({ accent: 'teal' }, { ...models, defaultStepId: 'missing' })).toThrow()
  expect(readFileSync(f.store.path, 'utf8')).toBe(original)
  writeFileSync(f.store.path, JSON.stringify({ accent: 'blue', fontSize: 16, futureOption: { keep: true } }))
  f.store.set({ accent: 'teal' }, models)
  expect(JSON.parse(readFileSync(f.store.path, 'utf8'))).toMatchObject({
    accent: 'teal',
    fontSize: 16,
    models,
    futureOption: { keep: true },
  })
  expect(readdirSync(f.directory).filter((name) => name.includes('.tmp.'))).toEqual([])
})

watched('ignores abandoned temporary writes on restart', () => {
  const f = fixture({ accent: 'teal' })
  f.store.close()
  writeFileSync(`${f.store.path}.tmp.interrupted`, '{"accent":')
  const restarted = new SettingsStore(f.directory, { preferences: {}, models: null })
  cleanup.push(() => restarted.close())
  expect(restarted.preferences().accent).toBe('teal')
})

watched('preserves the committed file and cache if atomic replacement fails and cleans up the temporary file', () => {
  const f = fixture({ accent: 'teal' })
  const original = readFileSync(f.store.path, 'utf8')
  vi.mocked(renameSync).mockImplementationOnce(() => {
    throw new Error('Simulated interrupted replacement')
  })
  expect(() => f.store.set({ accent: 'violet' })).toThrow('Simulated interrupted replacement')
  expect(readFileSync(f.store.path, 'utf8')).toBe(original)
  expect(f.store.preferences().accent).toBe('teal')
  expect(readdirSync(f.directory).filter((name) => name.includes('.tmp.'))).toEqual([])
})
