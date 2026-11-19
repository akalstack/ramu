import { expect, it } from 'vitest'
import {
  estimatedTokens,
  normalizeRulePaths,
  ruleCharacters,
  ruleDuplicates,
  rulePathsLine,
  rulePathsProblem,
  ruleScopeCosts,
} from '../src/rules'
import type { Rule } from '../src/types/rules'

const rule = (id: string, patch: Partial<Rule> = {}): Rule => ({
  id,
  name: id,
  body: `Body of ${id}.`,
  projectId: null,
  providers: [],
  activation: 'always',
  paths: [],
  enabled: true,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

it('costs each scope as host-wide rules plus the project, counting only enabled always-on rules', () => {
  const costs = ruleScopeCosts([
    rule('host', { body: 'x'.repeat(96) }),
    rule('p1', { projectId: 'p', body: 'y'.repeat(198) }),
    rule('off', { body: 'z'.repeat(500), enabled: false }),
    rule('manual', { projectId: 'p', body: 'z'.repeat(500), activation: 'manual' }),
    rule('q1', { projectId: 'q', body: 'q' }),
  ])
  expect(costs.map(({ projectId, rules, characters }) => ({ projectId, rules, characters }))).toEqual([
    { projectId: null, rules: 1, characters: 100 },
    { projectId: 'p', rules: 2, characters: 300 },
    { projectId: 'q', rules: 2, characters: 103 },
  ])
  expect(costs[0]!.limit).toBe(24000)
  expect(estimatedTokens(costs[1]!.characters)).toBe(75)
  expect(ruleScopeCosts([])).toEqual([{ projectId: null, rules: 0, characters: 0, limit: 24000 }])
})

it('warns about identical text or the same name only between enabled rules one thread can receive together', () => {
  const duplicates = ruleDuplicates([
    rule('a', { name: 'Tests', body: 'Write  the test\nfirst.' }),
    rule('b', { name: 'Testing', body: 'Write the test first.', projectId: 'p' }),
    rule('c', { name: 'tests', body: 'Something else.', providers: ['codex'] }),
    // Another project's rule never reaches the same thread as project p's.
    rule('d', { name: 'Testing', body: 'Write the test first.', projectId: 'q' }),
    // Different providers never meet in one thread.
    rule('e', { name: 'Deploy', providers: ['codex'] }),
    rule('f', { name: 'Deploy', providers: ['claude-code'] }),
    rule('g', { name: 'Tests', enabled: false }),
  ])
  expect(Object.fromEntries(duplicates)).toEqual({
    a: { kind: 'text', others: ['b', 'd'] },
    b: { kind: 'text', others: ['a'] },
    c: { kind: 'name', others: ['a'] },
    d: { kind: 'text', others: ['a'] },
  })
})

it('normalizes file patterns and refuses ones that are absolute, leave the repository or are too many', () => {
  expect(normalizeRulePaths([' ./src/api/** ', '', '**/*.test.ts', 'src/api/**'])).toEqual([
    'src/api/**',
    '**/*.test.ts',
  ])
  expect(rulePathsProblem(['src/api/**', '**/*.test.ts'])).toBeNull()
  const message = (paths: string[]) => rulePathsProblem(paths)?.message
  expect(message([])).toMatch(/at least one/)
  expect(message(['/etc/**'])).toMatch(/relative/)
  expect(message(['~/notes/*.md'])).toMatch(/relative/)
  expect(message(['C:/repo/**'])).toMatch(/relative/)
  expect(message(['src/../../secrets/**'])).toMatch(/\.\./)
  expect(message(['src\\api'])).toMatch(/Use \//)
  expect(message(['src/\napi'])).toMatch(/control/)
  expect(message(['x'.repeat(201)])).toMatch(/characters or fewer/)
  expect(message(Array.from({ length: 21 }, (_, i) => `src/${i}/**`))).toMatch(/up to/)
})

it('counts a path rule, with the line naming its patterns, toward the budget like an always rule', () => {
  const paths = ['src/api/**']
  const costs = ruleScopeCosts([rule('p', { activation: 'paths', paths, body: 'x' })])
  expect(costs[0]).toMatchObject({ rules: 1, characters: 1 + 1 + rulePathsLine(paths).length + 1 })
  expect(ruleCharacters({ name: 'p', body: 'x', activation: 'paths', paths })).toBe(costs[0]!.characters)
})
