import { expect, it } from 'vitest'
import { featureBranchName, sanitizeBranchFragment, uniqueFeatureBranch } from '../src/workspace/git'
import { splitBranchLine } from '../src/agent'

it('names feature branches the way T3 Code does', () => {
  expect(sanitizeBranchFragment('  Add SSH pairing!! ')).toBe('add-ssh-pairing')
  expect(sanitizeBranchFragment('...')).toBe('')
  expect(featureBranchName('ssh-pairing')).toBe('feature/ssh-pairing')
  expect(featureBranchName('fix/ssh-pairing')).toBe('fix/ssh-pairing')
  expect(uniqueFeatureBranch([], 'ssh-pairing')).toBe('feature/ssh-pairing')
  expect(uniqueFeatureBranch(['feature/ssh-pairing', 'feature/ssh-pairing-2'], 'ssh-pairing')).toBe(
    'feature/ssh-pairing-3',
  )
  expect(uniqueFeatureBranch(['feature/ssh-pairing/old'], 'ssh-pairing')).toBe('feature/ssh-pairing-2')
  expect(uniqueFeatureBranch(['main'])).toMatch(/^feature\/changes-[a-z0-9]{8,}$/)
  expect(featureBranchName('...')).toMatch(/^feature\/changes-[a-z0-9]{8,}$/)
})

it('takes the suggested branch off a drafted message', () => {
  expect(splitBranchLine({ message: 'feat: add ssh pairing\n\nBody.\nBranch: `ssh-pairing`' })).toEqual({
    message: 'feat: add ssh pairing\n\nBody.',
    branch: 'ssh-pairing',
  })
  expect(splitBranchLine({ message: 'fix: typo' })).toEqual({ message: 'fix: typo' })
})
