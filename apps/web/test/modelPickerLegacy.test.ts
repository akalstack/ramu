import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import { ModelPicker } from '../src/models/ModelPicker'
import { visiblePickerModels } from '../src/models/modelVisibility'

const stored = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/deviceStorage', () => ({
  deviceStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    subscribe: () => () => {},
  },
}))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage: () => 'en' }))
vi.mock('../src/settings/AppSettings', () => ({
  useAppSettings: () => ({
    preferences: { favoriteModels: [], fontSize: 14 },
    save: async () => {},
  }),
}))
vi.mock('../src/settings/Usage', () => ({ useUsage: () => [], peakUsage: () => null }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('react-dom', () => ({ createPortal: () => null }))
vi.mock('../src/models/ModelSets', () => ({
  modelDisplayName: (name: string) => name,
  useModelSets: () => ({
    catalogs: [
      {
        provider: 'codex',
        models: [
          {
            provider: 'codex',
            id: 'new',
            name: 'Current Sol',
            isDefault: true,
            efforts: ['low'],
            defaultEffort: 'low',
          },
          {
            provider: 'codex',
            id: 'old',
            name: 'Older Sol',
            isDefault: false,
            efforts: ['low'],
            defaultEffort: 'low',
            isLegacy: true,
          },
        ],
      },
    ],
    preferences: { sets: [] },
    reload: async () => {},
  }),
}))

afterEach(() => {
  stored.clear()
  vi.unstubAllGlobals()
})

it('renders a legacy reveal control and labels older models when revealed or selected', () => {
  vi.stubGlobal('document', { body: {} })
  const render = (model = 'new') =>
    renderToStaticMarkup(
      createElement(ModelPicker, {
        settings: { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', model },
        onChange() {},
        onDone() {},
        onSet() {},
      }),
    )
  const hidden = render()
  expect(hidden).toContain('Current Sol')
  expect(hidden).toContain('Show legacy models')
  expect(hidden).not.toContain('Older Sol')
  stored.set('ramu.show-legacy-models', 'true')
  const revealed = render()
  expect(revealed).toContain('Older Sol')
  expect(revealed).toContain('Hide legacy models')
  expect(revealed).toContain('Legacy')
  stored.clear()
  expect(render('old')).toContain('Older Sol')
})

it('keeps a provider list out of the picker and search, but not the model in use', () => {
  const models = [
    { provider: 'opencode', id: 'kept', name: 'Kept', isDefault: false, efforts: [], defaultEffort: '' },
    { provider: 'opencode', id: 'left-out', name: 'Left out', isDefault: false, efforts: [], defaultEffort: '' },
  ] as never[]
  const options = {
    showLegacy: false,
    settings: { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' as const, model: 'x' },
    favorites: [],
    visible: { opencode: ['kept'] },
  }
  const ids = (extra: object) =>
    visiblePickerModels(models, { ...options, query: 'o', ...extra }).map((model) => model.id)
  expect(ids({})).toEqual(['kept'])
  expect(ids({ settings: { ...options.settings, provider: 'opencode', model: 'left-out' } })).toEqual([
    'kept',
    'left-out',
  ])
})
