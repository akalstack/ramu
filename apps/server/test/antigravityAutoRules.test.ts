import { expect, it } from 'vitest'
import { isRoutineGitRead, matchesAntigravityDefault } from '../src/agent/antigravityAutoRules'

it.each([
  'git diff',
  'git diff --stat',
  'git diff --cached --name-only',
  'git diff HEAD~1 -- apps/server',
  'git status --porcelain=v1',
  'git log --oneline -n 5',
  'git show HEAD --stat',
])('allows the routine read %s', (command) => {
  expect(isRoutineGitRead(command)).toBe(true)
})
it.each([
  'git diff --output=x',
  'git diff --ext-diff',
  'git show --textconv',
  'git log --output=x',
  'git -c core.pager=evil diff',
  'git -C /tmp diff',
  'git reset --hard',
  'git diff; whoami',
  'git diff | cat',
  'git diff $(pwd)',
  'git diff `pwd`',
  'git diff > out',
  'git diff\nrm -rf tmp',
  'git diff --unknown',
])('requires review for %s', (command) => {
  expect(isRoutineGitRead(command)).toBe(false)
})
it('treats unknown shell syntax as review-only, including remembered exact compound commands', () => {
  for (const command of ['git diff && whoami', '/bin/rm -rf tmp', 'bash -c pwd', 'env X=1 git diff'])
    expect(matchesAntigravityDefault('shell-review', command)).toBe(true)
})
