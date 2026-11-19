import { expect, it } from 'vitest'
import { setupFromText, setupReachText } from '../src/mcp'

const t = (text: string, values: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
const name = (provider: string) => ({ 'claude-code': 'Claude', codex: 'Codex' })[provider] ?? provider

it('names where a skill comes from, user files by path and project files under their folder, two at most', () => {
  const user = { scope: 'user' as const, label: 'Claude', file: '~/.claude/skills/review', enabled: true }
  const project = { scope: 'project' as const, label: 'app', file: '.claude/skills/review', enabled: true }
  expect(setupFromText([user, project], t)).toBe('~/.claude/skills/review, app/.claude/skills/review')
  expect(setupFromText([user, project, { ...project, label: 'web' }, { ...project, label: 'api' }], t)).toBe(
    '~/.claude/skills/review, app/.claude/skills/review and 2 more',
  )
})

it('says who has it now: shared, blocked, off everywhere, or only some providers', () => {
  const base = { shared: false, shareScope: 'default' as const, nativeProviders: [] }
  expect(setupReachText({ ...base, shared: true, shareScope: 'project' }, t, name)).toBe(
    'Shared with every provider and account in this project',
  )
  expect(setupReachText({ ...base, shareBlocked: 'Too large to share' }, t, name)).toBe('Too large to share')
  expect(setupReachText(base, t, name)).toBe('Turned off in every provider')
  expect(setupReachText({ ...base, nativeProviders: ['claude-code', 'codex'] }, t, name)).toBe('Only in Claude, Codex')
})
