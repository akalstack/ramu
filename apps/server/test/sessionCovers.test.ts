import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SessionStore } from '../src/agent/sessionStore'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT } from '@ramu/shared/types'

let db: ReturnType<typeof openDb>
beforeEach(() => {
  db = openDb(':memory:')
})
afterEach(() => db.close())

it('lets a thread reach a repository added inside the folder it works in, and nothing outside it', async () => {
  const workspace = new Workspace(db, '/tmp/ramu-session-covers-test')
  const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Workspace', mode: 'current' })
  const store = new SessionStore({ onEvent: () => {} }, db)
  const scope = { cwd: '/work/app', additionalDirs: [], covers: ['/work/app'] }
  const lead = store.createSession(task.id, scope, DEFAULT_AGENT_SETTINGS, 'idle')

  expect(store.cover(task.id, '/work/app/backend')).toEqual([lead.id])
  expect(store.get(lead.id).covers).toEqual(['/work/app', '/work/app/backend'])
  // Adding it again changes nothing, and a repository outside the thread's folder is never gained.
  expect(store.cover(task.id, '/work/app/backend')).toEqual([])
  expect(store.cover(task.id, '/work/application')).toEqual([])
  expect(store.get(lead.id).covers).toEqual(['/work/app', '/work/app/backend'])
})
