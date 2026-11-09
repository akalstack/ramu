import { join } from 'node:path'
import { expect, it } from 'vitest'
import { RAMU_FILES_REFUSAL, ramuFileRefusal } from '../src/agent/ramuFiles'

const data = '/home/me/.config/Ramu'
const scope = { cwd: '/work/app' }

it('refuses file writes into Ramu’s settings and data folder', () => {
  expect(ramuFileRefusal(join(data, 'settings.json'), scope, data)).toBe(RAMU_FILES_REFUSAL)
  expect(ramuFileRefusal(join(data, 'ramu.db'), scope, data)).toBe(RAMU_FILES_REFUSAL)
  expect(ramuFileRefusal('../../home/me/.config/Ramu/credentials/x', scope, data)).toBe(RAMU_FILES_REFUSAL)
})

it('allows the thread’s own folders, even a helper worktree inside the data folder, but never settings.json', () => {
  expect(ramuFileRefusal('src/index.ts', scope, data)).toBeNull()
  const helper = { cwd: join(data, 'subagent-worktrees', 'a') }
  expect(ramuFileRefusal('src/index.ts', helper, data)).toBeNull()
  expect(ramuFileRefusal(join(data, 'settings.json'), { cwd: data }, data)).toBe(RAMU_FILES_REFUSAL)
  expect(ramuFileRefusal(join(data, 'ramu.db'), { cwd: data }, data)).toBe(RAMU_FILES_REFUSAL)
  expect(ramuFileRefusal(undefined, scope, data)).toBeNull()
})
