import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentModel, type AgentProvider } from '@ramu/shared/types'
import { effortDisplayName, modelStepName, settingsNames } from '../src/models/ModelSets'
import { ReasoningPicker } from '../src/models/ReasoningPicker'

vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: vi.fn() }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: vi.fn() }))
vi.mock('../src/workspace/workspace', () => ({ useHostRuntime: vi.fn() }))
vi.mock('../src/Brand', () => ({ BootScreen: vi.fn() }))

vi.mock('../src/i18n', () => ({ t: (value: string) => value, useLanguage: () => 'en' }))
vi.mock('../src/Menu', () => ({
  MenuItems: ({ items }: { items: { key: string; label?: unknown; selected?: boolean }[] }) =>
    createElement(
      'div',
      null,
      ...items.map((item) =>
        createElement('div', { key: item.key, 'data-selected': item.selected }, item.label as string),
      ),
    ),
}))

const modelFor = (provider: AgentProvider): AgentModel => ({
  provider,
  id: 'test',
  name: 'Test model',
  efforts: ['low', 'high'],
  defaultEffort: 'high',
  isDefault: true,
})

describe('provider effort names', () => {
  it('calls Codex low effort Low', () => {
    expect(effortDisplayName('low', 'codex')).toBe('Low')
  })
  it.each(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as AgentProvider[])(
    'resolves the actual catalog default for %s across settings, steps and the picker',
    (provider) => {
      const model = modelFor(provider)
      const catalogs = [{ provider, models: [model] }]
      const settings = { ...DEFAULT_AGENT_SETTINGS, provider, model: '', effort: null }
      expect(settingsNames(settings, catalogs).effort).toBe('High')
      expect(modelStepName({ id: 'step', name: 'Step', provider, model: '', effort: null }, catalogs)).toBe(
        'Test model High',
      )
      const html = renderToStaticMarkup(
        createElement(ReasoningPicker, {
          settings,
          model,
          onChange: () => {},
          onDone: () => {},
        }),
      )
      expect(html).toContain('data-selected="true"><span class="grow flex-1 min-w-0 text-left">High')
      expect(html).not.toContain('Default')
      expect(html).not.toContain('Model default')
    },
  )
  it('does not invent an effort for models with no separate effort setting', () => {
    const model = { ...modelFor('cursor'), efforts: [], defaultEffort: null }
    expect(
      settingsNames({ ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', model: 'test', effort: null }, [
        { provider: 'cursor', models: [model] },
      ]).effort,
    ).toBe('')
    expect(effortDisplayName(null, 'cursor')).toBe('')
  })
})
