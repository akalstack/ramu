import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { LocalDiagnostics } from '../src/background/diagnostics'
let db: Db, workspace: Workspace, diagnostics: LocalDiagnostics
beforeEach(() => {
  db = openDb(':memory:')
  workspace = new Workspace(db, '/tmp/ramu-diagnostics-test')
  diagnostics = new LocalDiagnostics(workspace)
})
afterEach(() => db.close())
it('collects nothing by default, and exports only allowlisted metadata after opt-in', () => {
  const error = Object.assign(new TypeError('secret prompt and /Users/private/code.ts'), {
    code: 'ENOENT',
    custom: 'secret source',
  })
  diagnostics.record('service-error', error)
  expect(diagnostics.list()).toEqual([])
  workspace.setAppState('app-preferences', { localCrashReports: true })
  diagnostics.record('service-error', error)
  expect(diagnostics.list()[0]).toMatchObject({ errorType: 'TypeError', code: 'ENOENT', kind: 'service-error' })
  expect(diagnostics.export()).not.toMatch(/secret|private|code.ts|stack|message/)
  const malicious = Object.assign(new Error('not recorded'), { name: 'secret-name', code: 'secret-token' })
  diagnostics.record('service-error', malicious)
  expect(diagnostics.list()[1]).toMatchObject({ errorType: 'Error' })
  expect(diagnostics.export()).not.toContain('secret')
  workspace.setAppState('app-preferences', { localCrashReports: false })
  diagnostics.record('service-crash', error)
  expect(diagnostics.list()).toHaveLength(2)
  diagnostics.clear()
  expect(diagnostics.list()).toEqual([])
})
it('bounds report storage and survives a service recreation', () => {
  workspace.setAppState('app-preferences', { localCrashReports: true })
  for (let i = 0; i < 120; i++) diagnostics.record('service-error', new Error())
  expect(new LocalDiagnostics(workspace).list()).toHaveLength(100)
})
