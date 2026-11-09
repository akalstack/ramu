import { describe, expect, it } from 'vitest'
import { accountKey } from '@ramu/shared/identities'
import { IdentityService, IdentityMismatchError } from '../src/identities/service'

function service(
  places = [
    { id: 'api', folders: ['/Users/ada/work/api'], remotes: ['git@github.com:acme/api.git'] },
    { id: 'blog', folders: ['/Users/ada/code/blog'], remotes: ['https://github.com/ada/blog'] },
  ],
) {
  const state = new Map<string, unknown>()
  const identities = new IdentityService({
    getState: (key, fallback) => (state.has(key) ? (structuredClone(state.get(key)) as never) : fallback),
    setState: (key, value) => void state.set(key, structuredClone(value)),
    places: () => places,
    changed: () => {},
    home: '/Users/ada',
    gitUser: () => ({ name: 'Ada', email: 'ada@host.example' }),
  })
  const personal = identities.add({ name: 'Personal', gitAuthor: { name: 'Ada', email: 'ada@gmail.com' } })
  const work = identities.add({
    name: 'Work',
    gitAuthor: { name: 'Ada Lovelace', email: 'ada@acme.com' },
    rules: [{ kind: 'remote', host: 'github.com', owner: 'acme' }],
  })
  return { identities, personal, work }
}

describe('identities on a host', () => {
  it('picks each project’s identity without choosing anything, and commits as it', () => {
    const { identities } = service()
    expect(identities.forProject('api')?.name).toBe('Work')
    expect(identities.forProject('blog')?.name).toBe('Personal')
    expect(identities.environment('api')).toMatchObject({
      GIT_AUTHOR_EMAIL: 'ada@acme.com',
      GIT_COMMITTER_NAME: 'Ada Lovelace',
    })
  })

  it('a pin moves a project to another identity at once', () => {
    const { identities, personal } = service()
    identities.pin('api', personal.id)
    expect(identities.environment('api').GIT_AUTHOR_EMAIL).toBe('ada@gmail.com')
    identities.pin('api', null)
    expect(identities.forProject('api')?.name).toBe('Work')
  })

  it('removing an identity moves its projects to the one chosen', () => {
    const { identities, work, personal } = service()
    identities.assign(accountKey('provider', 'claude-code', 'work'), [work.id])
    identities.remove(work.id, personal.id)
    expect(identities.forProject('api')?.name).toBe('Personal')
    expect(identities.settings().accounts[accountKey('provider', 'claude-code', 'work')]).toEqual([personal.id])
  })

  it('stops an action with another identity’s account and lets it continue once', () => {
    const { identities, personal } = service()
    const key = accountKey('forge', 'github', 'personal-token')
    identities.assign(key, [personal.id])
    expect(() => identities.guard('api', key, 'Pushing')).toThrow(IdentityMismatchError)
    expect(identities.mismatch('api')).toMatchObject({ expected: { name: 'Work' }, actual: { name: 'Personal' } })
    identities.continueAs('api')
    expect(() => identities.guard('api', key, 'Pushing')).not.toThrow()
    expect(() => identities.guard('api', key, 'Pushing')).toThrow(IdentityMismatchError)
    // A shared account never stops anything.
    expect(() => identities.guard('api', accountKey('forge', 'github', 'shared'), 'Pushing')).not.toThrow()
  })

  it('uses its own account of a kind once it has one, never another identity’s', () => {
    const { identities, work, personal } = service()
    const logins = ['default', 'work', 'personal'].map((id) => accountKey('provider', 'claude-code', id))
    expect(identities.choose('api', logins, (key) => key)).toEqual(logins)
    identities.assign(logins[2]!, [personal.id])
    expect(identities.choose('api', logins, (key) => key)).toEqual(logins.slice(0, 2))
    identities.assign(logins[1]!, [work.id])
    expect(identities.choose('api', logins, (key) => key)).toEqual([logins[1]])
    expect(identities.choose('blog', logins, (key) => key)).toEqual([logins[2]])
  })

  it('compares hosts by email, falling back to the host’s Git config with no identities', () => {
    const { identities } = service()
    expect(identities.email('api')).toBe('ada@acme.com')
    expect(identities.email({ id: 'new', folders: ['/srv/x'], remotes: ['git@github.com:acme/x.git'] })).toBe(
      'ada@acme.com',
    )
    const bare = new IdentityService({
      getState: (_key, fallback) => fallback,
      setState: () => {},
      places: () => [],
      changed: () => {},
      gitUser: () => ({ name: 'Ada', email: 'ada@host.example' }),
    })
    expect(bare.email('anything')).toBe('ada@host.example')
  })

  it('offers the host’s global Git user for a first identity, and nothing when Git has none', () => {
    const { identities } = service()
    expect(identities.gitUser()).toEqual({ name: 'Ada', email: 'ada@host.example' })
    const bare = new IdentityService({
      getState: (_key, fallback) => fallback,
      setState: () => {},
      places: () => [],
      changed: () => {},
    })
    expect(bare.gitUser()).toEqual({ name: null, email: null })
    expect(bare.email(null)).toBeNull()
  })
})

describe('the identity’s GitHub account in a project’s processes', () => {
  it('gives gh and Git over https the token of the account put in the identity, and nothing without one', () => {
    const { identities } = service()
    expect(identities.environment('api').GH_TOKEN).toBeUndefined()
    identities.setForgeTokens(new Map([['api', 'ghp_work']]))
    const env = identities.environment('api')
    expect(env).toMatchObject({ GH_TOKEN: 'ghp_work', GIT_CONFIG_COUNT: '2', GIT_CONFIG_VALUE_0: '' })
    expect(env.GIT_CONFIG_VALUE_1).toContain('$GH_TOKEN')
    expect(identities.environment('blog').GH_TOKEN).toBeUndefined()
  })

  it('points a repository at the GitHub account its project identity owns', () => {
    const { identities, work } = service()
    expect(identities.forgeChoice('github.com', 'acme', 'api')).toBeNull()
    identities.assign(accountKey('forge', 'github', 'conn-work'), [work.id])
    expect(identities.forgeChoice('github.com', 'acme', 'api')).toBe('conn-work')
    expect(identities.forgeChoice('github.com', 'ada', 'blog')).toBeNull()
  })
})
