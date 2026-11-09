import { expect, it, vi } from 'vitest'

vi.mock('../src/i18n', () => ({
  t: (value: string, values: Record<string, string> = {}) =>
    value.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match),
  useLanguage() {},
}))
import {
  activationLabel,
  claudeCopyNote,
  duplicateNote,
  ruleReach,
  ruleTokens,
  scopeCostLine,
} from '../src/settings/rulesView'

it("labels each activation and says where Claude Code's copy of a path rule is written", () => {
  expect((['always', 'manual', 'paths'] as const).map(activationLabel)).toEqual([
    'Always',
    'Manual',
    'When files match',
  ])
  expect(claudeCopyNote('p')).toMatch(/\.claude\/rules in each of this project's repositories/)
  expect(claudeCopyNote(null)).toMatch(/your Claude config home/)
})

it('names the providers a rule reaches, or every provider when none is chosen', () => {
  expect(ruleReach({ providers: [] })).toBe('Every provider')
  expect(ruleReach({ providers: ['codex', 'claude-code'] })).toBe('Codex, Claude')
})

it('states a scope cost as estimated tokens against the character budget', () => {
  expect(scopeCostLine({ projectId: 'p', rules: 2, characters: 1200, limit: 24000 }, 'Ramu')).toBe(
    `Ramu: about 300 tokens (${(1200).toLocaleString()} of ${(24000).toLocaleString()} characters)`,
  )
  expect(ruleTokens(5)).toBe('About 2 tokens')
})

it('names the rules a duplicate repeats and suggests the fix for its kind', () => {
  const rules = [
    { id: 'a', name: 'Tests first' },
    { id: 'b', name: 'Testing' },
  ]
  expect(duplicateNote({ kind: 'text', others: ['a', 'b'] }, rules)).toBe(
    'Same text as Tests first, Testing. Both apply; turn one off or delete it.',
  )
  expect(duplicateNote({ kind: 'name', others: ['a'] }, rules)).toBe(
    'Same name as Tests first. Both apply; rename one or turn it off.',
  )
})
