import { describe, expect, it } from 'vitest'
import { projectGroupKey, repositoryIdentity } from '../src/repositoryIdentity'

describe('repositoryIdentity', () => {
  it('names one repository the same way however it was cloned', () => {
    const same = [
      'git@github.com:Akalstack/Ramu.git',
      'https://github.com/akalstack/ramu',
      'https://token@github.com/akalstack/ramu.git/',
      'ssh://git@github.com:22/akalstack/ramu.git',
      '  git://github.com/akalstack/ramu.git  ',
    ]
    for (const remote of same) expect(repositoryIdentity(remote)).toBe('github.com/akalstack/ramu')
    expect(repositoryIdentity('git@gitlab.example.com:group/sub/app.git')).toBe('gitlab.example.com/group/sub/app')
  })

  it('says nothing for a remote that names no host', () => {
    for (const remote of ['', '/srv/git/app.git', '../app', 'file:///srv/git/app.git', 'origin'])
      expect(repositoryIdentity(remote)).toBeNull()
  })
})

describe('projectGroupKey', () => {
  it('puts one repository’s projects together across hosts and leaves the rest under their host', () => {
    const repository = 'github.com/akalstack/ramu'
    expect(projectGroupKey('a', { id: 'p1', repository })).toBe(projectGroupKey('b', { id: 'p9', repository }))
    expect(projectGroupKey('a', { id: 'p1' })).not.toBe(projectGroupKey('b', { id: 'p1' }))
    expect(projectGroupKey('a', { id: 'p1', repository: null })).toBe('host:a:p1')
  })
})
