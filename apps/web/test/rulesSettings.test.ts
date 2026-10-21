import { expect, it, vi } from 'vitest'

vi.mock('../src/i18n', () => ({
  t: (value: string) => value,
  useLanguage() {},
}))
import { ruleReach } from '../src/settings/rulesView'

it('names the providers a rule reaches, or every provider when none is chosen', () => {
  expect(ruleReach({ providers: [] })).toBe('Every provider')
  expect(ruleReach({ providers: ['codex', 'claude-code'] })).toBe('Codex, Claude')
})
