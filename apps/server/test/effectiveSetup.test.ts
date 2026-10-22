import { expect, it } from 'vitest'
import type { Rule } from '@ramu/shared/types'
import { buildSetupSnapshot, type SetupInputs } from '../src/agent/effectiveSetup'

const rule = (patch: Partial<Rule>): Rule => ({
  id: 'r',
  name: 'Tests first',
  body: 'Write the test first.',
  projectId: null,
  providers: [],
  activation: 'always',
  enabled: true,
  revision: 1,
  createdAt: 100,
  updatedAt: 100,
  ...patch,
})
const base = (patch: Partial<SetupInputs> = {}): SetupInputs => ({
  sessionId: 's',
  provider: 'claude-code',
  accountId: 'default',
  projectId: 'p1',
  startedAt: 1000,
  rules: [],
  addedServers: [],
  sharedSkills: [],
  connections: [],
  now: 2000,
  ...patch,
})

it('lists only rules that reach the thread and separates delivered, changed and manual ones', () => {
  const snapshot = buildSetupSnapshot(
    base({
      rules: [
        rule({ id: 'a', name: 'Delivered' }),
        rule({ id: 'b', name: 'Edited later', updatedAt: 1500 }),
        rule({ id: 'c', name: 'Manual', activation: 'manual' }),
        rule({ id: 'd', name: 'Other project', projectId: 'p2' }),
        rule({ id: 'e', name: 'Other provider', providers: ['codex'] }),
        rule({ id: 'f', name: 'Off', enabled: false }),
      ],
    }),
  )
  expect(snapshot.items.map((item) => [item.name, item.state])).toEqual([
    ['Delivered', 'delivered'],
    ['Edited later', 'needs-refresh'],
    ['Manual', 'omitted'],
  ])
  expect(snapshot.rulesCharacters).toBe('Delivered'.length + 21 + 'Edited later'.length + 21)
})

it('confirms a server only when the live runtime reports it connected', () => {
  const items = (runtimeServers?: { name: string; status: string }[]) =>
    buildSetupSnapshot(base({ addedServers: ['docs', 'db'], ...(runtimeServers ? { runtimeServers } : {}) })).items.map(
      (item) => [item.name, item.state],
    )
  expect(items([{ name: 'docs', status: 'connected' }])).toEqual([
    ['docs', 'runtime-confirmed'],
    ['db', 'configured'],
  ])
  expect(items([{ name: 'docs', status: 'failed' }])[0]).toEqual(['docs', 'configured'])
  expect(items()).toEqual([
    ['docs', 'configured'],
    ['db', 'configured'],
  ])
})

it('never calls Shared MCP loaded and gives the next step for an unready connection', () => {
  const { items } = buildSetupSnapshot(
    base({
      connections: [
        { name: 'Atlassian', status: 'ready' },
        { name: 'Linear', status: 'approval-needed' },
      ],
    }),
  )
  expect(items.map((item) => [item.name, item.state])).toEqual([
    ['Atlassian', 'configured'],
    ['Linear', 'omitted'],
  ])
  expect(items[1]!.reason).toMatch(/Review access/)
  expect(JSON.stringify(items)).not.toMatch(/Write the test first/)
})

it('flags a shared server or skill whose source changed after the thread started', () => {
  const items = buildSetupSnapshot(
    base({ addedServers: ['docs', 'db'], sharedSkills: ['review'], changedSources: ['server:db', 'skill:review'] }),
  ).items
  expect(items.map((item) => [item.name, item.state])).toEqual([
    ['docs', 'configured'],
    ['db', 'needs-refresh'],
    ['review', 'needs-refresh'],
  ])
})

it('says how each runtime receives rules and omits them all when they are over its size', () => {
  const reason = (provider: 'claude-code' | 'codex' | 'cursor') =>
    buildSetupSnapshot(base({ provider, rules: [rule({})] })).items[0]!.reason
  expect(reason('claude-code')).toContain('system prompt')
  expect(reason('codex')).toContain('developer instructions')
  expect(reason('cursor')).toContain('ahead of the first message')
  const big = buildSetupSnapshot(base({ rules: [rule({ id: 'a', body: 'x'.repeat(25_000) })] }))
  expect(big.items.map((item) => item.state)).toEqual(['omitted'])
})
