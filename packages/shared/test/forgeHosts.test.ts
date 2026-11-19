import { expect, it } from 'vitest'
import { forgeKind, glabHosts, parseGitlabRemote } from '../src/forgeHosts'

it('recognises each hosting service and keeps unknown servers on GitHub', () => {
  expect(forgeKind('github.com')).toBe('github')
  expect(forgeKind('git.example.com')).toBe('github')
  expect(forgeKind('gitlab.com')).toBe('gitlab')
  expect(forgeKind('code.example.com', new Set(['code.example.com']))).toBe('gitlab')
  expect(forgeKind('code.example.com:8443', new Set(['code.example.com']))).toBe('gitlab')
  expect(forgeKind('bitbucket.org')).toBe('bitbucket')
  expect(forgeKind('dev.azure.com')).toBe('azure')
  expect(forgeKind('team.visualstudio.com')).toBe('azure')
})

it('reads nested GitLab namespaces from HTTPS and SSH remotes and refuses embedded passwords', () => {
  expect(parseGitlabRemote('https://gitlab.com/group/sub/app.git')).toEqual({
    origin: 'gitlab.com',
    path: 'group/sub/app',
  })
  expect(parseGitlabRemote('git@gitlab.com:group/sub/app.git')).toEqual({ origin: 'gitlab.com', path: 'group/sub/app' })
  expect(parseGitlabRemote('ssh://git@code.example.com:2222/team/app.git')).toEqual({
    origin: 'code.example.com',
    path: 'team/app',
  })
  expect(parseGitlabRemote('https://code.example.com:8443/team/app')).toEqual({
    origin: 'code.example.com:8443',
    path: 'team/app',
  })
  expect(parseGitlabRemote('https://user:secret@gitlab.com/team/app.git')).toBeNull()
  expect(parseGitlabRemote('https://gitlab.com/app.git')).toBeNull()
  expect(parseGitlabRemote('/local/path')).toBeNull()
})

it('reads only host sign-ins from a glab config, including OAuth ones kept in the keyring', () => {
  const config = [
    'git_protocol: ssh',
    'token: not-a-host-token',
    'hosts:',
    '    gitlab.com:',
    '        api_protocol: https',
    '        token: glpat-one',
    '    "code.example.com":',
    '        token: "glpat-two"',
    '    oauth.example.com:',
    '        # Store the credentials in the keyring',
    '        use_keyring: true',
    '        is_oauth2: "true"',
    '        oauth2_expiry_date: "2026-11-09T22:03:42+07:00"',
    '    empty.example.com:',
    '        user: someone',
    'editor: vim',
  ].join('\n')
  expect([...glabHosts(config)]).toEqual([
    ['gitlab.com', { token: 'glpat-one', oauth: false, expiresAt: null }],
    ['code.example.com', { token: 'glpat-two', oauth: false, expiresAt: null }],
    ['oauth.example.com', { token: null, oauth: true, expiresAt: Date.parse('2026-11-09T15:03:42Z') }],
  ])
})
