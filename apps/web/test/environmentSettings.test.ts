import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type { ProviderEnvironmentStatus } from '@ramu/shared/providers/environment'

vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (text: string, values: Record<string, string> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? key),
}))
vi.mock('../src/settings/SettingsScope', () => ({ useScopedInvoke: () => async () => {} }))
vi.mock('../src/components/settings-row', () => ({
  SettingsGroupTitle: ({ children }: { children: string }) => createElement('h4', null, children),
}))
import { EnvironmentSettings, type ProviderEnvironment } from '../src/settings/EnvironmentSettings'

const render = (status: ProviderEnvironmentStatus, cursorEnabled = true) =>
  renderToStaticMarkup(
    createElement(EnvironmentSettings, {
      environment: {
        status,
        draft: status.values ?? {},
        setDraft: () => {},
        changed: false,
        save: async () => {},
        load: async () => {},
        loading: false,
        error: null,
      } satisfies ProviderEnvironment,
      preferences: {
        ...DEFAULT_APP_PREFERENCES,
        providerBinaries: { cursor: { binary: '', enabled: cursorEnabled } },
      },
      busy: false,
    }),
  )

it('edits values on the host, masked by default, with a blank row for the next variable', () => {
  const html = render({
    state: 'available',
    canAdminister: true,
    keys: { global: ['HTTPS_PROXY'] },
    values: { global: [{ key: 'HTTPS_PROXY', value: 'http://secret-proxy' }] },
  })
  expect(html).toContain('value="HTTPS_PROXY"')
  expect(html).toMatch(
    /type="password"[^>]*value="http:\/\/secret-proxy"|value="http:\/\/secret-proxy"[^>]*type="password"/,
  )
  expect(html).toContain('NAME — or paste a .env file')
  expect(html).toContain('Copy as .env')
})

it('lists only enabled providers, and shows names without values to other clients', () => {
  const html = render({ state: 'available', canAdminister: false, keys: { global: ['OPENAI_BASE_URL'] } }, false)
  expect(html).toContain('<code class="text-caption">OPENAI_BASE_URL</code>')
  expect(html).not.toContain('Copy as .env')
  expect(html).toContain('Claude')
  expect(html).not.toContain('Cursor')
})

it('offers a retry when saved values cannot be read', () => {
  const html = render({ state: 'unavailable', canAdminister: true, keys: { global: ['X'] } })
  expect(html).toContain('Unlock the credential store')
  expect(html).toContain('Try again')
  expect(html).not.toContain('Copy as .env')
})
