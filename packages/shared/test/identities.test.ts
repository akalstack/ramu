import { describe, expect, it } from 'vitest'
import {
  accountAllowed,
  accountsFor,
  crossHostWarning,
  gitAuthorEnvironment,
  identityFor,
  identityMismatch,
  levelApplies,
  normalizeIdentities,
  parseRule,
  remoteOwner,
  suggestedRule,
  type Identity,
  type IdentitySettings,
} from '../src/identities'

const identity = (id: string, rules: Identity['rules'], isDefault = false): Identity => ({
  id,
  name: id,
  color: 'violet',
  gitAuthor: { name: id, email: `${id}@example.com` },
  rules,
  isDefault,
  createdAt: 1,
})
const settings: IdentitySettings = {
  identities: [
    identity('personal', [{ kind: 'folder', pattern: '~/code/**' }], true),
    identity('work', [
      { kind: 'folder', pattern: '~/work/**' },
      { kind: 'remote', host: 'github.com', owner: 'acme' },
    ]),
    identity('client', [{ kind: 'folder', pattern: '~/work/globex' }]),
  ],
  accounts: {},
  pins: {},
}
const HOME = '/Users/ada'

describe('which identity a project acts as', () => {
  it('picks the most specific rule, a remote owner over any folder', () => {
    expect(identityFor({ id: 'a', folders: ['/Users/ada/work/api'], remotes: [] }, settings, HOME)?.identity.id).toBe(
      'work',
    )
    expect(
      identityFor({ id: 'b', folders: ['/Users/ada/work/globex/site'], remotes: [] }, settings, HOME)?.identity.id,
    ).toBe('client')
    expect(
      identityFor({ id: 'c', folders: ['/Users/ada/code/x'], remotes: ['git@github.com:acme/x.git'] }, settings, HOME)
        ?.identity.id,
    ).toBe('work')
    expect(identityFor({ id: 'd', folders: ['/tmp/x'], remotes: [] }, settings, HOME)).toMatchObject({
      identity: { id: 'personal' },
      reason: 'default',
    })
  })

  it('a pin from the project menu wins over every rule', () => {
    expect(
      identityFor(
        { id: 'a', folders: ['/Users/ada/work/api'], remotes: [] },
        { ...settings, pins: { a: 'personal' } },
        HOME,
      ),
    ).toMatchObject({ identity: { id: 'personal' }, reason: 'pinned' })
  })

  it('no identities is no change', () => {
    expect(
      identityFor({ id: 'a', folders: [], remotes: [] }, { identities: [], accounts: {}, pins: {} }, HOME),
    ).toBeNull()
  })

  it('offers a rule from a remote owner nothing catches yet, once', () => {
    const project = { id: 'p', folders: ['/tmp/p'], remotes: ['https://github.com/initech/api'] }
    expect(suggestedRule(project, settings)).toEqual({ kind: 'remote', host: 'github.com', owner: 'initech' })
    expect(suggestedRule(project, { ...settings, offered: ['p'] })).toBeNull()
    expect(suggestedRule({ ...project, remotes: ['git@github.com:acme/api.git'] }, settings)).toBeNull()
  })
})

describe('shared unless split', () => {
  const logins = [
    'provider:claude-code:work-login',
    'provider:claude-code:personal-login',
    'provider:claude-code:shared',
  ]
  it('uses its own account of a kind, else one for every identity, never another’s', () => {
    const accounts = {
      'provider:claude-code:work-login': ['work'],
      'provider:claude-code:personal-login': ['personal'],
    }
    expect(accountsFor(logins, (key) => key, 'work', accounts)).toEqual(['provider:claude-code:work-login'])
    expect(accountsFor(logins, (key) => key, 'client', accounts)).toEqual(['provider:claude-code:shared'])
    expect(accountAllowed('provider:claude-code:personal-login', 'work', accounts)).toBe(false)
    expect(accountAllowed('provider:claude-code:shared', 'work', accounts)).toBe(true)
  })

  it('with one login and two identities both use it', () => {
    expect(accountsFor(['provider:claude-code:only'], (key) => key, 'work', {})).toEqual(['provider:claude-code:only'])
  })

  it('names both identities when the account belongs to another', () => {
    const work = settings.identities[1]!
    expect(identityMismatch('forge:me', work, { ...settings, accounts: { 'forge:me': ['personal'] } })).toMatchObject({
      expected: { id: 'work' },
      actual: { id: 'personal' },
    })
    expect(identityMismatch('forge:shared', work, settings)).toBeNull()
  })
})

describe('helpers', () => {
  it('reads remote owners and parses typed rules', () => {
    expect(remoteOwner('git@github.com:acme/api.git')).toEqual({ host: 'github.com', owner: 'acme' })
    expect(remoteOwner('https://gitlab.acme.com/team/api')).toEqual({ host: 'gitlab.acme.com', owner: 'team' })
    expect(parseRule('~/work/**')).toEqual({ kind: 'folder', pattern: '~/work/**' })
    expect(parseRule('github.com/acme/*')).toEqual({ kind: 'remote', host: 'github.com', owner: 'acme' })
    expect(parseRule('nonsense')).toBeNull()
  })

  it('sets the Git author for started processes', () => {
    expect(gitAuthorEnvironment(settings.identities[1]!)).toEqual({
      GIT_AUTHOR_NAME: 'work',
      GIT_AUTHOR_EMAIL: 'work@example.com',
      GIT_COMMITTER_NAME: 'work',
      GIT_COMMITTER_EMAIL: 'work@example.com',
    })
  })

  it('keeps exactly one default and drops references to removed identities', () => {
    const normalized = normalizeIdentities({
      identities: [identity('a', []), identity('b', [])],
      accounts: { k: ['gone', 'a'], j: ['gone'] },
      pins: { p: 'gone', q: 'b' },
    })
    expect(normalized.identities.filter((entry) => entry.isDefault)).toHaveLength(1)
    expect(normalized.accounts).toEqual({ k: ['a'] })
    expect(normalized.pins).toEqual({ q: 'b' })
  })

  it('recalls a note at its level only', () => {
    expect(levelApplies({ kind: 'identity', identityId: 'work' }, { projectId: 'p', identityId: 'personal' })).toBe(
      false,
    )
    expect(levelApplies({ kind: 'everywhere' }, { projectId: 'p', identityId: 'personal' })).toBe(true)
  })

  it('warns only when the Git emails differ', () => {
    expect(crossHostWarning('you@acme.com', 'You@Acme.com', 'home')).toBeNull()
    expect(crossHostWarning('you@acme.com', 'you@gmail.com', 'home-server')).toBe(
      'This thread is you@acme.com. On home-server it would run as you@gmail.com.',
    )
  })
})
