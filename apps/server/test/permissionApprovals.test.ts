import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb, type Db } from '../src/db'
import { PermissionApprovals, permissionKey } from '../src/agent/permissionApprovals'
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
