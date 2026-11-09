import { beforeEach, expect, it } from 'vitest'
import { RULE_BODY_LIMIT, RULE_TOTAL_LIMIT, type RuleInput } from '@ramu/shared/types'
import { openDb } from '../src/db'
import { RULES_PREAMBLE, RuleStore } from '../src/rules/rules'
import { sessionGuidance } from '../src/agent/guidance'

let rules: RuleStore
beforeEach(() => {
  rules = new RuleStore(openDb(':memory:'))
})
const input = (patch: Partial<RuleInput> = {}): RuleInput => ({
  name: 'Tests first',
  body: 'Write the failing test before the fix.',
  projectId: null,
  providers: [],
  activation: 'always',
  paths: [],
  enabled: true,
  ...patch,
})

it('creates a rule with revision 1 and keeps every revision', () => {
  const first = rules.save(input(), 1000)
  expect(first).toMatchObject({ revision: 1, enabled: true, providers: [] })
  const second = rules.save(input({ id: first.id, baseRevision: 1, body: 'Always write the test first.' }), 2000)
  expect(second.revision).toBe(2)
  expect(rules.history(first.id).map((entry) => entry.revision)).toEqual([2, 1])
})

it('refuses an edit that started from an older revision instead of overwriting', () => {
  const first = rules.save(input())
  rules.save(input({ id: first.id, baseRevision: 1, body: 'Changed elsewhere.' }))
  expect(() => rules.save(input({ id: first.id, baseRevision: 1, body: 'Stale edit.' }))).toThrow(/changed since/)
  expect(rules.get(first.id).body).toBe('Changed elsewhere.')
})

it('restores an old revision as a new one, so history only grows', () => {
  const first = rules.save(input({ body: 'Original text.' }))
  rules.save(input({ id: first.id, baseRevision: 1, body: 'Edited text.' }))
  const restored = rules.restore(first.id, 1)
  expect(restored).toMatchObject({ revision: 3, body: 'Original text.' })
  expect(rules.history(first.id)).toHaveLength(3)
  expect(() => rules.restore(first.id, 99)).toThrow(/no longer exists/)
})

it('validates names, text and size, and refuses rather than truncates', () => {
  expect(() => rules.save(input({ name: '  ' }))).toThrow(/Name the rule/)
  expect(() => rules.save(input({ body: ' ' }))).toThrow(/some text/)
  expect(() => rules.save(input({ body: 'x'.repeat(RULE_BODY_LIMIT + 1) }))).toThrow(/split/)
  const chunk = 'x'.repeat(RULE_BODY_LIMIT)
  rules.save(input({ name: 'a', body: chunk }))
  rules.save(input({ name: 'b', body: chunk }))
  expect(() => rules.save(input({ name: 'c', body: chunk }))).toThrow(new RegExp(`of ${RULE_TOTAL_LIMIT}`))
  // The same text is fine when switched off or manual, and in an unrelated project's scope it only counts with host rules.
  expect(rules.save(input({ name: 'c', body: chunk, enabled: false })).enabled).toBe(false)
  expect(rules.save(input({ name: 'd', body: chunk, activation: 'manual' })).activation).toBe('manual')
})

it('checks a host-wide rule against every project it would join, and a project rule only against its own', () => {
  const chunk = 'x'.repeat(RULE_BODY_LIMIT)
  rules.save(input({ name: 'p-a', body: chunk, projectId: 'p1' }))
  rules.save(input({ name: 'p-b', body: chunk, projectId: 'p1' }))
  rules.save(input({ name: 'q-a', body: chunk, projectId: 'p2' }))
  // Host-wide text that fits with p2 but not with p1 is refused for p1's sake.
  expect(() => rules.save(input({ name: 'host', body: chunk }))).toThrow(/of 24000 characters/)
  expect(rules.save(input({ name: 'host', body: 'x'.repeat(100) })).enabled).toBe(true)
  // Two projects' rules never reach the same thread, so they do not add up.
  expect(rules.save(input({ name: 'q-b', body: chunk, projectId: 'p2' })).projectId).toBe('p2')
})

it("delivers only enabled always-on rules for the session project and provider, labelled as the user's own", () => {
  rules.save(input({ name: 'Everywhere' }))
  rules.save(input({ name: 'Project only', projectId: 'p1' }))
  rules.save(input({ name: 'Other project', projectId: 'p2' }))
  rules.save(input({ name: 'Claude only', providers: ['claude-code'] }))
  rules.save(input({ name: 'Off', enabled: false }))
  rules.save(input({ name: 'Manual', activation: 'manual' }))
  const names = (project: string | null, provider: 'codex' | 'claude-code') =>
    rules.applicable(project, provider).map((rule) => rule.name)
  expect(names('p1', 'codex')).toEqual(['Everywhere', 'Project only'])
  expect(names('p1', 'claude-code')).toEqual(['Claude only', 'Everywhere', 'Project only'])
  expect(names(null, 'codex')).toEqual(['Everywhere'])
  const text = rules.instructions('p1', 'codex')!
  expect(text.startsWith(RULES_PREAMBLE)).toBe(true)
  expect(text).toContain('### Everywhere')
  expect(text).not.toContain('Manual')
  expect(rules.instructions(null, 'codex')).toContain('Everywhere')
  expect(new RuleStore(openDb(':memory:')).instructions(null, 'codex')).toBeUndefined()
})

it('sends path rules with their patterns to runtimes without path activation, but never to Claude Code as text', () => {
  rules.save(input({ name: 'API', body: 'Validate every input.', activation: 'paths', paths: ['src/api/**'] }))
  const codex = rules.instructions(null, 'codex')!
  expect(codex).toContain('### API\nApplies when you work on files matching: `src/api/**`.\nValidate every input.')
  expect(rules.instructions(null, 'opencode')).toContain('`src/api/**`')
  expect(rules.instructions(null, 'claude-code')).toBeUndefined()
})

it('stores path patterns normalized, refuses invalid ones and keeps them through history and restore', () => {
  const pathRule = (paths: string[]) => input({ name: 'API', activation: 'paths', paths })
  expect(() => rules.save(pathRule([]))).toThrow(/at least one file pattern/)
  expect(() => rules.save(pathRule(['/abs/**']))).toThrow(/relative to the repository/)
  expect(() => rules.save(pathRule(['../other/**']))).toThrow(/cannot use \.\./)
  const first = rules.save(pathRule([' ./src/api/** ', 'src/api/**']))
  expect(first.paths).toEqual(['src/api/**'])
  // Patterns belong to path activation only.
  expect(rules.save(input({ name: 'Always', paths: ['src/**'] })).paths).toEqual([])
  rules.save({ ...pathRule(['**/*.test.ts']), id: first.id, baseRevision: 1 })
  expect(rules.history(first.id).map((entry) => entry.paths)).toEqual([['**/*.test.ts'], ['src/api/**']])
  expect(rules.restore(first.id, 1).paths).toEqual(['src/api/**'])
  expect(rules.get(first.id).paths).toEqual(['src/api/**'])
})

it('removing a project removes only its rules, and removing a rule drops its history', () => {
  const host = rules.save(input({ name: 'Host' }))
  const project = rules.save(input({ name: 'Project', projectId: 'p1' }))
  rules.removeForProject('p1')
  expect(rules.list().map((rule) => rule.id)).toEqual([host.id])
  expect(() => rules.history(project.id)).toThrow(/Unknown rule/)
  rules.remove(host.id)
  expect(rules.list()).toEqual([])
})

it('puts the rules section after the other guidance and omits it when empty', () => {
  const base = {
    questions: 'native' as const,
    background: false,
    advisor: false,
    goal: null,
    nativeSubagentNote: false,
    memory: undefined,
    toolSearch: false,
    learning: undefined,
  }
  expect(sessionGuidance({ ...base, rules: undefined })).not.toContain(RULES_PREAMBLE)
  const text = sessionGuidance({ ...base, rules: `${RULES_PREAMBLE}\n\n### A\nBody` })
  expect(text.endsWith('### A\nBody')).toBe(true)
})
