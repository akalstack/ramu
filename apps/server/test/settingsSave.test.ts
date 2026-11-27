import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { SettingsSnapshot } from '@ramu/shared/settingsCompatibility'
import { createDispatcher, type Services } from '../src/ipc'
import { CatalogService } from '../src/agent/catalogService'
import * as catalog from '../src/agent/catalog'
import { SettingsStore } from '../src/settings/settingsStore'
import { configureProviderBinaries } from '../src/providers/providerBinaries'
import { recommendedSets } from '@ramu/shared/providers/modelDefaults'
import type { ModelPreferences } from '@ramu/shared/types'

it('reuses discovered models across ordinary saves and refreshes them for UI and external provider changes', async () => {
  vi.stubEnv('RAMU_FAKE_AGENT', '0')
  const discovery = vi.spyOn(catalog, 'discoverCatalogs').mockResolvedValue(catalog.fakeCatalogs())
  const directory = mkdtempSync(join(tmpdir(), 'ramu-settings-save-'))
  const store = new SettingsStore(directory)
  const catalogs: CatalogService = new CatalogService({
    preferences: () => store.preferences(),
    catalog: () => catalogs.discoverCatalog(false),
    providerQuery: () => {
      throw new Error('Must not launch a provider')
    },
  })
  const dispatcher = createDispatcher({ userData: directory, send: () => {}, native: async () => null }, {
    workspace: {
      settingsStore: store,
      getAppState: (key: string, fallback: unknown) =>
        key === 'app-preferences' ? store.preferences() : key === 'model-preferences' ? store.models() : fallback,
      setAppState: (_key: string, value: unknown) => store.set(undefined, value),
    },
    agents: {
      catalog: () => catalogs.discoverCatalog(false),
      invalidateCatalog: () => catalogs.invalidateCatalog(),
      goalsSettingsChanged: () => {},
    },
  } as unknown as Services)
  const snapshot = () => dispatcher.invoke('settings.app.snapshot', []) as Promise<SettingsSnapshot>
  const patch = (saved: SettingsSnapshot, path: string, value: unknown) => {
    const field = saved.settings.find((field) => field.path === path)!
    return dispatcher.invoke('settings.app.patch', [
      [{ ...field, before: field.value, value }],
    ]) as Promise<SettingsSnapshot>
  }
  try {
    let saved = await snapshot()
    expect(discovery).toHaveBeenCalledTimes(1)
    store.set(undefined, recommendedSets(catalog.fakeCatalogs().slice(0, 1)))
    const generated = (await dispatcher.invoke('settings.models.get', [])) as ModelPreferences
    expect(generated.sets[0]!.generated).toBeDefined()
    expect(store.models()).toEqual(generated)
    expect(new Set(generated.sets[0]!.steps.map((step) => step.provider))).toEqual(
      new Set(
        catalog
          .fakeCatalogs()
          .filter((entry) => entry.models.length)
          .map((entry) => entry.provider),
      ),
    )
    store.set(undefined, null)
    // Selecting a flow on a phone creates host defaults when absent, then changes only presentation.
    saved = await patch(saved, '$models.defaultBarMode', 'effort')
    expect(saved.models?.defaultBarMode).toBe('effort')
    const models = saved.models!
    const external = { ...models, sets: [...models.sets, { ...models.sets[0]!, id: 'custom', name: 'Custom' }] }
    store.set(store.preferences(), external)
    saved = await patch(saved, '$models.defaultBarMode', 'model')
    expect(saved.models?.sets).toEqual(external.sets)
    expect(saved.models?.defaultStepId).toBe(models.defaultStepId)
    expect(saved.models?.defaultBarMode).toBe('model')
    const stale = saved
    store.set(undefined, { ...saved.models, defaultBarMode: 'effort' })
    await expect(patch(stale, '$models.defaultBarMode', 'model')).rejects.toThrow(/changed elsewhere/)
    saved = await snapshot()
    saved = await patch(saved, '$models.defaultBarMode', 'model')
    expect(saved.models?.sets).toEqual(external.sets)
    // The all-mobile layer is separate from the all-device value, and `inherit` removes it again.
    saved = await patch(saved, '$models.mobileBarMode', 'effort')
    expect(saved.models?.mobileBarMode).toBe('effort')
    expect(saved.models?.defaultBarMode).toBe('model')
    expect(saved.settings.find((field) => field.path === '$models.mobileBarMode')?.value).toBe('effort')
    saved = await patch(saved, '$models.mobileBarMode', 'inherit')
    expect(saved.models?.mobileBarMode).toBeUndefined()
    expect(saved.models?.sets).toEqual(external.sets)
    expect(discovery).toHaveBeenCalledTimes(1)
    for (const value of [true, false, true]) {
      saved = await patch(saved, 'autoWatchPullRequests', value)
      expect(saved.preferences?.autoWatchPullRequests).toBe(value)
      expect(saved.catalogs).toEqual(catalog.fakeCatalogs())
      expect(discovery).toHaveBeenCalledTimes(1)
    }
    saved = await patch(saved, 'providerBinaries.codex.binary', '/custom/codex')
    expect(saved.preferences?.providerBinaries.codex?.binary).toBe('/custom/codex')
    // The save answers at once; the new provider setup is discovered by the next read of the list.
    expect(discovery).toHaveBeenCalledTimes(1)
    await snapshot()
    expect(discovery).toHaveBeenCalledTimes(2)
    writeFileSync(
      store.path,
      JSON.stringify({
        ...saved.preferences,
        providerBinaries: { ...saved.preferences!.providerBinaries, codex: { binary: '/external/codex' } },
      }),
    )
    store.reload()
    expect((await snapshot()).preferences?.providerBinaries.codex?.binary).toBe('/external/codex')
    expect(discovery).toHaveBeenCalledTimes(3)
  } finally {
    dispatcher.close()
    configureProviderBinaries({})
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  }
})
