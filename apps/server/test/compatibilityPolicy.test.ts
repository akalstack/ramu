import { expect, it } from 'vitest'
import { evaluateCompatibility, validatePolicy } from '@ramu/shared/providers/compatibility'
import type { AgentProvider } from '@ramu/shared/types'
import { COMPATIBILITY_POLICY, COMPATIBILITY_RUNTIME } from '../src/providers/compatibilityPolicy'

const evaluate = (provider: AgentProvider, version: string | null) =>
  evaluateCompatibility(COMPATIBILITY_POLICY, provider, COMPATIBILITY_RUNTIME[provider]!, version)

it('the bundled policy is valid and only audited runtimes are evaluated', () => {
  expect(validatePolicy(COMPATIBILITY_POLICY)).toEqual([])
  expect(Object.keys(COMPATIBILITY_RUNTIME)).toEqual(['codex', 'opencode', 'claude-code', 'antigravity', 'cursor'])
})

it('covers each tested release line through its later patches and minors, and stops at the next major', () => {
  const lines: [AgentProvider, string, string, string, string][] = [
    // provider, oldest tested, a later release in the line, the next major, older than anything tested
    ['claude-code', '2.1.308', '2.4.0', '3.0.0', '2.1.0'],
    ['codex', '0.150.0', '0.199.3', '1.0.0', '0.149.0'],
    ['opencode', '2.1.3', '2.9.0', '3.0.0', '1.14.19'],
    ['antigravity', '1.4.3', '1.6.2', '2.0.0', '1.3.0'],
  ]
  for (const [provider, oldest, later, major, older] of lines) {
    expect(evaluate(provider, oldest).status).toBe('supported')
    expect(evaluate(provider, later).status).toBe('supported')
    expect(evaluate(provider, major)).toMatchObject({ status: 'unverified', reason: 'newer-than-tested' })
    expect(evaluate(provider, older)).toMatchObject({ status: 'unverified', reason: 'no-rule' })
    expect(evaluate(provider, null).status).toBe('unverified')
  }
})

it('reports the newest release probed in the line', () => {
  expect(evaluate('antigravity', '1.5.3')).toMatchObject({ ruleId: 'antigravity-acp-1', testedVersion: '1.5.0' })
  expect(evaluate('codex', '0.168.0')).toMatchObject({ ruleId: 'codex-app-server-0', testedVersion: '0.167.0' })
})

it('covers Cursor builds from the first one probed, by their date-style version', () => {
  expect(evaluate('cursor', '2026.11.05-86047df')).toMatchObject({ status: 'supported', ruleId: 'cursor-acp' })
  expect(evaluate('cursor', '2026.12.01-aaaaaaa').status).toBe('supported')
  expect(evaluate('cursor', '2026.10.30-bbbbbbb').status).toBe('unverified')
})
