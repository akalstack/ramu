import { describe, expect, it } from 'vitest'
import {
  accessGroupTitle,
  accessGroups,
  forgeUnavailableKey,
  groupReadFailure,
  needsAccess,
  readFailure,
} from '../src/pullRequestAccess'

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

  it('reads what a failed read means from the messages the hosting clients give', () => {
    expect(readFailure('gh api failed: gh: HTTP 502')).toBe('outage')
    expect(readFailure('Bitbucket answered 503. Try again in a moment.')).toBe('outage')
    expect(readFailure('gh api failed: gh: API rate limit exceeded for user ID 1. (HTTP 403)')).toBe('rate-limit')
    // GitHub's 403 wording mentions a rate limit as one possibility; without the limit itself it is about access.
    expect(readFailure('HTTP 403: GitHub refused the request (rate limit or a missing permission). Forbidden')).toBe(
      'no-access',
    )
    expect(readFailure('HTTP 401: the saved GitHub token was rejected. It may be expired or revoked.')).toBe(
      'signed-out',
    )
    expect(readFailure('Bitbucket did not accept this credential. Connect again in Settings → Git.')).toBe('signed-out')
    expect(readFailure('gh api failed: To get started with GitHub CLI, please run:  gh auth login')).toBe('signed-out')
    expect(readFailure('HTTP 404: not found with this account. The repository may be private.')).toBe('no-access')
    expect(readFailure('GitLab could not find that project, or this account cannot see it.')).toBe('no-access')
    expect(readFailure('Could not reach Azure DevOps. Check the network and try again.')).toBe('network')
    expect(readFailure('gh api failed: error connecting to api.github.com')).toBe('network')
    expect(readFailure('something odd')).toBe('unknown')
  })

  it('names a group by the failure its repositories share', () => {
    expect(groupReadFailure(['gh api failed: gh: HTTP 502', 'gh api failed: gh: HTTP 504'])).toBe('outage')
    expect(groupReadFailure(['gh api failed: gh: HTTP 502', 'HTTP 404: not found'])).toBe('unknown')
    expect(groupReadFailure([])).toBe('unknown')
  })
})
