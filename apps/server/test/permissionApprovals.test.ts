import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerSettingsHandlers } from '../src/ipc/handlers/settings'
import { registerAgentHandlers } from '../src/ipc/handlers/agent'
import { openDb, type Db } from '../src/db'
import { PermissionApprovals, permissionKey, commandPatterns } from '../src/agent/permissionApprovals'
let db: Db
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-approvals-'))
  db = openDb(join(dir, 'state.sqlite'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

it('matches complete inputs with stable key ordering and never just the displayed prefix', () => {
  expect(permissionKey('Bash', { command: 'pwd', timeout: 1 })).toBe(
    permissionKey('Bash', { timeout: 1, command: 'pwd' }),
  )
  const prefix = 'echo ' + 'x'.repeat(5000)
  expect(permissionKey('Bash', { command: prefix + 'one' })).not.toBe(
    permissionKey('Bash', { command: prefix + 'two' }),
  )
  expect(permissionKey('Bash', { command: 'pwd' })).not.toBe(permissionKey('Other', { command: 'pwd' }))
})
it('project approvals stay within their project, provider and exact request', () => {
  const approvals = new PermissionApprovals(db)
  const action = permissionKey('Bash', { command: 'pwd' })
  approvals.remember('codex', action, 'project', 'p1')
  expect(approvals.match('codex', action, 'p1')).toBe('project')
  expect(approvals.match('codex', action, 'p2')).toBeUndefined()
  expect(approvals.match('claude-code', action, 'p1')).toBeUndefined()
  expect(approvals.match('codex', permissionKey('Bash', { command: 'ls' }), 'p1')).toBeUndefined()
  expect(() => approvals.remember('codex', action, 'project')).toThrow('project')
})
it('user approvals survive restarting and can be forgotten without removing project approvals', () => {
  const action = permissionKey('Bash', { command: 'pwd' })
  new PermissionApprovals(db).remember('codex', action, 'user')
  db.close()
  db = openDb(join(dir, 'state.sqlite'))
  const approvals = new PermissionApprovals(db)
  expect(approvals.match('codex', action, 'p2')).toBe('user')
  approvals.remember('codex', action, 'project', 'p1')
  approvals.forget('codex', action, 'user')
  expect(approvals.match('codex', action, 'p2')).toBeUndefined()
  expect(approvals.match('codex', action, 'p1')).toBe('project')
})

it('clearing approvals preserves other saved application state', () => {
  const approvals = new PermissionApprovals(db)
  approvals.remember('codex', 'action', 'user')
  approvals.remember('codex', 'action', 'project', 'p')
  db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('other-setting', 'saved')
  approvals.clear()
  expect(approvals.match('codex', 'action', 'p')).toBeUndefined()
  expect(db.prepare('SELECT value FROM app_state WHERE key = ?').get('other-setting')).toMatchObject({ value: 'saved' })
})

it('accepts scoped approvals after JSON transport turns an omitted message into null', () => {
  const replyPermission = vi.fn()
  const methods = registerAgentHandlers({ agents: { replyPermission } } as never)
  const method = methods['agent.replyPermission']!
  const args = JSON.parse(JSON.stringify(['session', 'request', true, undefined, 'project']))
  const parsed = method.args.parse(args)
  method.run(...parsed)
  expect(replyPermission).toHaveBeenCalledWith('session', 'request', true, undefined, 'project', undefined)
  expect(method.args.safeParse(['session', 'request', true, null, 'invalid-scope']).success).toBe(false)
})

it('offers narrow and executable rules without treating a shell expression as one command', () => {
  expect(commandPatterns('git diff --stat')).toEqual(['git diff *', 'git *'])
  expect(commandPatterns('git')).toEqual(['git *'])
  for (const command of [
    'git diff; rm -rf tmp',
    'git diff && echo hi',
    'git diff | cat',
    'git diff $(touch x)',
    'git diff\nwhoami',
    'bash -c pwd',
    'env git diff',
    'sudo git diff',
    'git diff `pwd`',
  ])
    expect(commandPatterns(command)).toEqual([])
})

it('matches command prefixes at argument boundaries and within the chosen provider and scope', () => {
  const approvals = new PermissionApprovals(db)
  approvals.remember('codex', 'initial', 'project', 'p1', { label: 'git diff *', pattern: 'git diff *' })
  expect(approvals.find('codex', 'new-input', 'p1', 'git diff --stat')?.pattern).toBe('git diff *')
  expect(approvals.find('codex', 'new-input', 'p1', 'git diff')).toBeDefined()
  for (const command of ['git status', 'git difftool', 'git diff; whoami', 'git diff && whoami'])
    expect(approvals.find('codex', 'new-input', 'p1', command)).toBeUndefined()
  expect(approvals.find('codex', 'new-input', 'p2', 'git diff --stat')).toBeUndefined()
  expect(approvals.find('antigravity', 'new-input', 'p1', 'git diff --stat')).toBeUndefined()
  approvals.remember('codex', 'initial', 'user', undefined, { label: 'git *', pattern: 'git *' })
  expect(approvals.find('codex', 'new-input', 'p2', 'git status')?.scope).toBe('user')
})

it.each(['user', 'project', 'projects', 'all'] as const)('removes only the selected %s scope', (scope) => {
  const approvals = new PermissionApprovals(db)
  approvals.remember('codex', 'one', 'user')
  approvals.remember('codex', 'two', 'project', 'p1')
  approvals.remember('codex', 'three', 'project', 'p2')
  approvals.clear({ scope, projectId: scope === 'project' ? 'p1' : undefined })
  expect(approvals.list()).toHaveLength(scope === 'all' ? 0 : scope === 'projects' ? 1 : 2)
  expect(approvals.match('codex', 'one')).toBe(scope === 'user' || scope === 'all' ? undefined : 'user')
  expect(approvals.match('codex', 'two', 'p1')).toBe(scope === 'user' ? 'project' : undefined)
  expect(approvals.match('codex', 'three', 'p2')).toBe(scope === 'user' || scope === 'project' ? 'project' : undefined)
})

it('removes one listed rule without removing its neighboring approvals', () => {
  const approvals = new PermissionApprovals(db)
  const id = approvals.remember('codex', 'one', 'user', undefined, { label: 'git diff *', pattern: 'git diff *' })
  approvals.remember('codex', 'two', 'user')
  expect(approvals.list().find((rule) => rule.id === id)).toMatchObject({ scope: 'user', label: 'git diff *' })
  approvals.remove(id)
  expect(approvals.list()).toHaveLength(1)
  expect(approvals.find('codex', 'new', 'p', 'git diff --stat')).toBeUndefined()
})

it('routes manager removals with explicit user, project, all-project and all scopes', () => {
  const agents = {
    clearPermissionApprovals: vi.fn(),
    listPermissionApprovals: vi.fn(() => []),
    removePermissionApproval: vi.fn(),
  }
  const methods = registerSettingsHandlers({ agents } as never)
  for (const scope of ['user', 'project', 'projects', 'all']) {
    const target = { scope, ...(scope === 'project' ? { projectId: 'p1' } : {}) }
    const method = methods['settings.permissions.clear']!
    method.run(...method.args.parse([target]))
    expect(agents.clearPermissionApprovals).toHaveBeenLastCalledWith(target)
  }
  const remove = methods['settings.permissions.remove']!
  remove.run(...remove.args.parse(['permission-approval:v1:rule']))
  expect(agents.removePermissionApproval).toHaveBeenCalledWith('permission-approval:v1:rule')
})

it('initializes visible Antigravity Auto defaults once and never restores removed rules implicitly', () => {
  const approvals = new PermissionApprovals(db)
  approvals.ensureAntigravityDefaults()
  const defaults = approvals.list()
  expect(defaults.length).toBeGreaterThan(10)
  expect(defaults.every((rule) => rule.provider === 'antigravity' && rule.scope === 'user' && rule.autoOnly)).toBe(true)
  const diff = defaults.find((rule) => rule.builtin === 'git-read:diff')!
  approvals.remove(diff.id)
  approvals.ensureAntigravityDefaults()
  expect(approvals.list().some((rule) => rule.id === diff.id)).toBe(false)
  approvals.clear({ scope: 'user' })
  approvals.ensureAntigravityDefaults()
  expect(approvals.list()).toEqual([])
})

it('limits default read approvals to Auto and gives review rules precedence over broad saved approvals', () => {
  const approvals = new PermissionApprovals(db)
  approvals.ensureAntigravityDefaults()
  const find = (command: string, access: 'auto' | 'edits' = 'auto') =>
    approvals.find('antigravity', 'new-input', 'p', command, access)
  expect(find('git diff --stat')).toMatchObject({ behavior: 'allow', builtin: 'git-read:diff' })
  expect(find('git status --short')).toMatchObject({ behavior: 'allow' })
  expect(find('pwd')).toMatchObject({ behavior: 'allow' })
  expect(find('git diff --stat', 'edits')).toBeUndefined()
  expect(find('npm test')).toBeUndefined()
  approvals.remember('antigravity', 'git', 'project', 'p', { label: 'git *', pattern: 'git *' })
  for (const command of [
    'git reset --hard',
    'git clean -fd',
    'git push origin main',
    'git diff --output=result',
    'git -c alias.wipe=reset wipe',
    'git diff && rm -rf tmp',
  ])
    expect(find(command)?.behavior).toBe('ask')
  approvals.remember('antigravity', 'rm', 'user', undefined, { label: 'rm *', pattern: 'rm *' })
  expect(find('rm -rf tmp')).toMatchObject({ behavior: 'ask' })
  expect(approvals.find('codex', 'new-input', 'p', 'git diff', 'auto')).toBeUndefined()
})
