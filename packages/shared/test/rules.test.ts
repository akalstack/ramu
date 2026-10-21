import { expect, it } from 'vitest'
import { estimatedTokens, ruleDuplicates, ruleScopeCosts } from '../src/rules'
import type { Rule } from '../src/types/rules'

const rule = (id: string, patch: Partial<Rule> = {}): Rule => ({
  id,
  name: id,
  body: `Body of ${id}.`,
  projectId: null,
  providers: [],
  activation: 'always',
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
