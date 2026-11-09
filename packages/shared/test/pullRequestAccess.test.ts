import { describe, expect, it } from 'vitest'
import { accessGroupTitle, accessGroups, forgeUnavailableKey, needsAccess } from '../src/pullRequestAccess'

const repo = (host: string, repoName: string, extra: Record<string, unknown> = {}) =>
  ({
    host,
    projectId: repoName,
    projectName: repoName,
    repoId: repoName,
    repoName,
    availability: 'signed-out',
    viewer: null,
    pullRequests: [],
    local: {},
    ...extra,
  }) as never

describe('repository access notices', () => {
  it('needs access only for a sign-in or a failed read', () => {
    expect(needsAccess({ availability: 'signed-out' })).toBe(true)
    expect(needsAccess({ availability: 'ready', error: 'rate limit exceeded' })).toBe(true)
    expect(needsAccess({ availability: 'ready' })).toBe(false)
    expect(needsAccess({ availability: 'no-remote' })).toBe(false)
  })

  it('folds repositories into one notice per host, service and problem', () => {
    const groups = accessGroups([
      repo('a', 'web'),
      repo('a', 'api'),
      repo('b', 'web'),
      repo('a', 'site', { service: 'gitlab' }),
      repo('a', 'docs', { availability: 'ready', error: 'boom' }),
    ])
    expect(groups.map((group) => [group.host, group.service, group.problem, group.repos.length])).toEqual([
      ['a', 'github', 'signed-out', 2],
      ['b', 'github', 'signed-out', 1],
      ['a', 'gitlab', 'signed-out', 1],
      ['a', 'github', 'error', 1],
    ])
  })

  it('titles a notice by its problem and names the fix per service', () => {
    const label = (entry: { repoName: string }) => entry.repoName
    const [web, api] = [repo('a', 'web'), repo('a', 'api')]
    expect(accessGroupTitle({ problem: 'signed-out', service: 'github', repos: [web] }, label, () => 'GitHub')).toEqual(
      ['{0} is not connected', { '0': 'GitHub' }],
    )
    expect(accessGroupTitle({ problem: 'error', service: 'github', repos: [web, api] }, label, () => '')).toEqual([
      '{0} repositories could not be read',
      { '0': 2 },
    ])
    expect(forgeUnavailableKey('signed-out', 'bitbucket')).toMatch(/^Connect Bitbucket/)
    expect(forgeUnavailableKey('no-cli')).toMatch(/^Install the GitHub CLI/)
  })
})
