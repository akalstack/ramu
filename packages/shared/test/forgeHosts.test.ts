import { expect, it } from 'vitest'
import { forgeKind, glabHosts, glabToken, parseGitlabRemote } from '../src/forgeHosts'

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

it('reads only host tokens from a glab config', () => {
  const config = [
    'git_protocol: ssh',
    'token: not-a-host-token',
    'hosts:',
    '    gitlab.com:',
    '        api_protocol: https',
    '        token: glpat-one',
    '    "code.example.com":',
    '        token: "glpat-two"',
    '    empty.example.com:',
    '        user: someone',
    'editor: vim',
  ].join('\n')
  expect([...glabHosts(config)]).toEqual([
    ['gitlab.com', 'glpat-one'],
    ['code.example.com', 'glpat-two'],
  ])
  expect(glabToken(config, 'GitLab.com')).toBe('glpat-one')
  expect(glabToken(config, 'empty.example.com')).toBeNull()
})
