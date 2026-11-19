import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  codexDisabledSkills,
  codexServers,
  discoverProjectSetup,
  parseJsonc,
  projectSharingKey,
  sharedSessionServers,
  sharedSessionSkills,
} from '../src/agent/projectSetup'
import { copySharedSkill } from '../src/memory/skillFiles'

let root: string, home: string
const skill = (name: string, body = 'Does a thing.') => `---\nname: ${name}\ndescription: ${body}\n---\nBody`
const put = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
const discover = (roots: string[], managed: Parameters<typeof discoverProjectSetup>[2] = []) =>
  discoverProjectSetup(
    'p',
    roots.map((label) => ({ label, path: join(root, label) })),
    managed,
    {},
    {},
    home,
  )
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-setup-')))
  home = join(root, 'home')
  mkdirSync(home)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('merges the same server across repositories and never reads secret values', () => {
  const server = { command: 'db-mcp', args: ['--x'], env: { TOKEN: 'super-secret' } }
  put(
    join(root, 'api/.mcp.json'),
    JSON.stringify({
      mcpServers: { db: server, docs: { url: 'https://docs/mcp', headers: { Authorization: 'Bearer t' } } },
    }),
  )
  put(join(root, 'web/.mcp.json'), JSON.stringify({ mcpServers: { database: server } }))
  const setup = discover(['api', 'web'])
  expect(setup.mcp.map((s) => [s.name, s.sources.map((x) => x.label)])).toEqual([
    ['db', ['api', 'web']],
    ['docs', ['api']],
  ])
  // Ramu forwards repository servers to every provider.
  expect(setup.mcp[0]!.providers).toHaveLength(5)
  expect(setup.mcp[0]!.envKeys).toEqual(['TOKEN'])
  expect(setup.mcp[1]!.headerKeys).toEqual(['Authorization'])
  expect(JSON.stringify(setup)).not.toContain('super-secret')
  expect(JSON.stringify(setup)).not.toContain('Bearer')
})

it('merges user-level servers from each provider and shows which providers lack one', () => {
  put(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: { kb: { type: 'http', url: 'https://kb/mcp', headers: { Authorization: 'Bearer secret-1' } } },
      projects: { [join(root, 'repo')]: { mcpServers: { local: { command: 'local-mcp' } } } },
    }),
  )
  put(
    join(home, '.codex/config.toml'),
    [
      '[mcp_servers.knowledge]',
      'url = "https://kb/mcp"',
      '[mcp_servers.knowledge.http_headers]',
      '"Authorization" = "Bearer secret-2"',
      '[mcp_servers.off]',
      'command = "off-mcp"',
      'enabled = false',
    ].join('\n'),
  )
  put(
    join(home, '.config/opencode/opencode.jsonc'),
    '{\n  // comment\n  "mcp": { "kb": { "type": "remote", "url": "https://kb/mcp", "headers": { "X-Key": "secret-3" } }, },\n}',
  )
  mkdirSync(join(root, 'repo'))
  const setup = discover(['repo'])
  const kb = setup.mcp.find((s) => s.name === 'kb')!
  expect(kb.scope).toBe('user')
  expect(kb.nativeProviders).toEqual(['claude-code', 'codex', 'opencode'])
  // Remote servers are shared by default, so every provider gets it.
  expect([kb.shared, kb.providers.length]).toEqual([true, 5])
  expect(kb.sources.map((s) => s.label)).toEqual(['Claude', 'Codex', 'OpenCode'])
  expect(kb.headerKeys).toEqual(['Authorization', 'X-Key'])
  // Claude's local project scope is forwarded by Ramu, so every provider gets it.
  const local = setup.mcp.find((s) => s.name === 'local')!
  expect([local.scope, local.providers.length]).toEqual(['project', 5])
  const off = setup.mcp.find((s) => s.name === 'off')!
  expect([off.providers, off.sources[0]!.enabled]).toEqual([[], false])
  expect(JSON.stringify(setup)).not.toMatch(/secret-\d/)
})

it('links a discovered server to a matching Shared MCP connection', () => {
  put(join(root, 'a/.mcp.json'), JSON.stringify({ mcpServers: { docs: { url: 'https://docs/mcp' } } }))
  const setup = discover(
    ['a'],
    [{ id: 'c1', transport: { type: 'http', url: 'https://docs/mcp', headerSecretRefs: {} } }],
  )
  expect(setup.mcp[0]!.managedConnectionId).toBe('c1')
})

it('flags one name with different transports and skips the reserved ramu server', () => {
  put(join(root, 'a/.mcp.json'), JSON.stringify({ mcpServers: { x: { command: 'one' }, ramu: { command: 'no' } } }))
  put(join(root, 'b/.mcp.json'), JSON.stringify({ mcpServers: { x: { command: 'two' } } }))
  const setup = discover(['a', 'b'])
  expect(setup.mcp).toHaveLength(2)
  expect(setup.mcp.every((s) => s.nameConflict)).toBe(true)
})

it('reports malformed files instead of dropping them silently', () => {
  put(join(root, 'a/.mcp.json'), '{nope')
  put(join(root, 'a/.agents/skills/bad/SKILL.md'), 'no frontmatter')
  put(join(root, 'a/.agents/skills/.index.json'), '{}')
  const setup = discover(['a'])
  expect(setup.mcp).toEqual([])
  expect(setup.diagnostics.map((d) => d.file.slice(root.length + 1)).sort()).toEqual([
    'a/.agents/skills/bad/SKILL.md',
    'a/.mcp.json',
  ])
})

it('merges skills by name across user and project folders and flags differing content', () => {
  put(join(home, '.claude/skills/review/SKILL.md'), skill('review'))
  put(join(root, 'b/.agents/skills/review/SKILL.md'), skill('review', 'Different.'))
  put(join(root, 'b/.agents/skills/lint/SKILL.md'), skill('lint'))
  // Providers accept frontmatter Ramu's strict installer rejects; listing still shows it.
  put(join(root, 'b/.claude/skills/loose/SKILL.md'), '---\nname: loose\ndescription: Reads a: b — c\n---\n')
  const setup = discover(['b'])
  const review = setup.skills.find((s) => s.name === 'review')!
  expect(review.sources.map((s) => s.label)).toEqual(['b', 'User'])
  expect([review.scope, review.nameConflict]).toEqual(['user', true])
  expect(review.providers).toEqual(['claude-code', 'codex', 'opencode'])
  expect(setup.skills.find((s) => s.name === 'lint')!.nameConflict).toBe(false)
  expect(setup.skills.find((s) => s.name === 'loose')!.description).toBe('Reads a: b — c')
})

it('reads Codex server tables, including multi-line arrays and inline env tables', () => {
  const servers = codexServers(
    [
      '[mcp_servers."quoted.name"]',
      'command = "npx"',
      'args = [',
      '  "-y", "@scope/pkg"',
      ']',
      'env = { API_KEY = "v1", OTHER = "v2" }',
      '[projects."/x"]',
      'trust_level = "trusted"',
    ].join('\n'),
  )
  expect(servers).toEqual([
    {
      name: 'quoted.name',
      transport: { type: 'stdio', command: 'npx', args: ['-y', '@scope/pkg'] },
      env: { API_KEY: 'v1', OTHER: 'v2' },
      headers: {},
      enabled: true,
    },
  ])
})

it('parses JSON with comments without touching strings that look like comments', () => {
  expect(parseJsonc('{ "url": "https://x//y", /* c */ "a": [1,], }')).toEqual({ url: 'https://x//y', a: [1] })
})

describe('sharing with every provider and account', () => {
  const codexConfig = [
    '[mcp_servers.atlassian]',
    'url = "https://pentools.example/mcp/atlassian"',
    '[mcp_servers.atlassian.http_headers]',
    '"X-Key" = "secret-key"',
    '[mcp_servers.repl]',
    'command = "/opt/repl"',
    '[mcp_servers.app]',
    'command = "./App.app/bin/client"',
    'cwd = "."',
  ].join('\n')
  const repo = () => {
    mkdirSync(join(root, 'repo'), { recursive: true })
    return [join(root, 'repo')]
  }
  const shared = (provider: Parameters<typeof sharedSessionServers>[1], accountEnv = {}, sharing = {}) =>
    sharedSessionServers(repo(), provider, accountEnv, { env: {}, home, sharing })

  it('gives a remote server from one provider to the others, with its headers, but not back to its own', () => {
    put(join(home, '.codex/config.toml'), codexConfig)
    const claude = shared('claude-code')
    expect(claude.map((s) => s.name)).toEqual(['atlassian'])
    expect(claude[0]!.headers).toEqual({ 'X-Key': 'secret-key' })
    expect(shared('codex').map((s) => s.name)).toEqual([])
  })

  it('turns a shared server on in a provider whose own copy is turned off', () => {
    put(join(home, '.codex/config.toml'), codexConfig)
    put(
      join(home, '.config/opencode/opencode.json'),
      JSON.stringify({
        mcp: { atlassian: { type: 'remote', url: 'https://pentools.example/mcp/atlassian', enabled: false } },
      }),
    )
    expect(shared('opencode').map((s) => s.name)).toEqual(['atlassian'])
  })

  it('reaches a second account of the same provider, which has its own empty configuration', () => {
    put(join(home, '.codex/config.toml'), codexConfig)
    const accountB = join(root, 'accounts/codex/b')
    mkdirSync(accountB, { recursive: true })
    expect(shared('codex', { CODEX_HOME: accountB }).map((s) => s.name)).toEqual(['atlassian'])
  })

  it('reaches Claude accounts with servers from Claude local scope of the default account', () => {
    put(
      join(home, '.claude.json'),
      JSON.stringify({ projects: { [join(root, 'repo')]: { mcpServers: { kb: { url: 'https://kb/mcp' } } } } }),
    )
    // The default account loads its own local scope.
    expect(shared('claude-code').map((s) => s.name)).toEqual([])
    const accountB = join(root, 'accounts/claude/b')
    mkdirSync(accountB, { recursive: true })
    expect(shared('claude-code', { CLAUDE_CONFIG_DIR: accountB }).map((s) => s.name)).toEqual(['kb'])
  })

  it('shares local commands only when turned on, never folder-relative ones, and honours turning a server off', () => {
    put(join(home, '.codex/config.toml'), codexConfig)
    const setup = discoverProjectSetup('p', [], [], {}, {}, home)
    const key = (name: string) => setup.mcp.find((s) => s.name === name)!.key
    expect(setup.mcp.find((s) => s.name === 'app')!.shareBlocked).toBeTruthy()
    expect(setup.mcp.find((s) => s.name === 'repl')!.shared).toBe(false)
    const on = { [key('repl')]: true, [key('app')]: true, [key('atlassian')]: false }
    expect(shared('claude-code', {}, on).map((s) => s.name)).toEqual(['repl'])
    const after = discoverProjectSetup('p', [], [], on, {}, home)
    expect(after.mcp.find((s) => s.name === 'repl')!.providers).toHaveLength(5)
    expect(after.mcp.find((s) => s.name === 'atlassian')!.providers).toEqual(['codex'])
    expect(JSON.stringify(after)).not.toContain('secret-key')
  })
})

describe('sharing for one project', () => {
  const dirs = () => {
    mkdirSync(join(root, 'repo'), { recursive: true })
    return [join(root, 'repo')]
  }

  it('shares a skill in the chosen project only, and a project choice beats the host-wide one', () => {
    put(join(home, '.claude/skills/bitbucket/SKILL.md'), skill('bitbucket'))
    const sharing = { [projectSharingKey('p1', 'bitbucket')]: true }
    const names = (projectId: string, choices: Record<string, boolean>) =>
      sharedSessionSkills(dirs(), 'codex', {}, choices, { env: {}, home, projectId }).map((s) => s.name)
    expect(names('p1', sharing)).toEqual(['bitbucket'])
    expect(names('p2', sharing)).toEqual([])
    const widened = { bitbucket: true, [projectSharingKey('p2', 'bitbucket')]: false }
    expect(names('p1', widened)).toEqual(['bitbucket'])
    expect(names('p2', widened)).toEqual([])
    const [shown] = discoverProjectSetup('p1', [], [], {}, {}, home, sharing).skills
    expect([shown!.shared, shown!.shareScope]).toEqual([true, 'project'])
    expect(discoverProjectSetup('p2', [], [], {}, {}, home, sharing).skills[0]!.shareScope).toBe('default')
  })
})

describe('skills shared with every provider and account', () => {
  const dirs = () => {
    mkdirSync(join(root, 'repo'), { recursive: true })
    return [join(root, 'repo')]
  }
  const names = (provider: Parameters<typeof sharedSessionSkills>[1], accountEnv = {}, sharing = {}) =>
    sharedSessionSkills(dirs(), provider, accountEnv, sharing, { env: {}, home }).map((s) => s.name)

  it('lists a skill with the providers that really load it, and honours Codex turning it off', () => {
    put(join(home, '.claude/skills/bitbucket/SKILL.md'), skill('bitbucket'))
    put(join(home, '.codex/skills/hatch-pet/SKILL.md'), skill('hatch-pet'))
    put(
      join(home, '.codex/config.toml'),
      `[[skills.config]]\npath = "${join(home, '.codex/skills/hatch-pet/SKILL.md')}"\nenabled = false\n`,
    )
    const setup = discover([])
    const bitbucket = setup.skills.find((s) => s.name === 'bitbucket')!
    expect(bitbucket.providers).toEqual(['claude-code', 'opencode'])
    expect([bitbucket.shared, bitbucket.nativeProviders]).toEqual([false, ['claude-code', 'opencode']])
    expect(setup.skills.find((s) => s.name === 'hatch-pet')!.providers).toEqual([])
    expect([
      ...codexDisabledSkills(
        '[[skills.config]]\npath = "/x/SKILL.md"\nenabled = false\n[[skills.config]]\npath = "/y/SKILL.md"\nenabled = true',
      ),
    ]).toEqual(['/x/SKILL.md'])
  })

  it('shares nothing until a skill is turned on, then reaches every provider that lacks it', () => {
    put(join(home, '.claude/skills/bitbucket/SKILL.md'), skill('bitbucket'))
    expect(names('codex')).toEqual([])
    const on = { bitbucket: true }
    expect(names('codex', {}, on)).toEqual(['bitbucket'])
    expect(names('cursor', {}, on)).toEqual(['bitbucket'])
    // Claude loads it from its own folder already.
    expect(names('claude-code', {}, on)).toEqual([])
    const shared = discoverProjectSetup('p', [], [], {}, {}, home, on).skills[0]!
    expect([shared.shared, shared.providers.length]).toEqual([true, 5])
  })

  it('reaches a second Claude account, whose own folder is empty', () => {
    put(join(home, '.claude/skills/bitbucket/SKILL.md'), skill('bitbucket'))
    const accountB = join(root, 'accounts/claude/b')
    mkdirSync(accountB, { recursive: true })
    expect(names('claude-code', { CLAUDE_CONFIG_DIR: accountB }, { bitbucket: true })).toEqual(['bitbucket'])
  })

  it('prefers the project copy and refuses names other providers would not accept', () => {
    put(join(home, '.claude/skills/review/SKILL.md'), skill('review', 'User copy.'))
    put(join(root, 'repo/.agents/skills/review/SKILL.md'), skill('review', 'Project copy.'))
    put(join(home, '.claude/skills/odd/SKILL.md'), '---\nname: Odd Name\ndescription: x\n---\n')
    const [review] = sharedSessionSkills(dirs(), 'cursor', {}, { review: true }, { env: {}, home })
    expect(review!.dir).toContain('repo/.agents/skills/review')
    const odd = discoverProjectSetup('p', [], [], {}, {}, home, { 'Odd Name': true }).skills.find(
      (s) => s.name === 'Odd Name',
    )!
    expect([odd.shared, !!odd.shareBlocked]).toEqual([false, true])
  })

  it('copies a skill under its export name without hidden files and refuses links', () => {
    put(join(root, 'src/SKILL.md'), skill('bitbucket'))
    put(join(root, 'src/scripts/run.sh'), 'echo')
    put(join(root, 'src/.DS_Store'), '')
    const out = join(root, 'out/ramu-bitbucket')
    copySharedSkill(join(root, 'src'), out, 'ramu-bitbucket')
    expect(readFileSync(join(out, 'SKILL.md'), 'utf8')).toContain('name: ramu-bitbucket')
    expect(existsSync(join(out, 'scripts/run.sh'))).toBe(true)
    expect(existsSync(join(out, '.DS_Store'))).toBe(false)
    symlinkSync('/etc/hosts', join(root, 'src/link'))
    expect(() => copySharedSkill(join(root, 'src'), join(root, 'out/other'), 'ramu-other')).toThrow(/symlink/)
  })
})

it('reports an unusable server on its own and still loads the rest of its file', () => {
  put(
    join(root, 'api/.mcp.json'),
    JSON.stringify({ mcpServers: { broken: { type: 'sse' }, docs: { url: 'https://docs/mcp' } } }),
  )
  put(
    join(home, '.codex/config.toml'),
    ['[mcp_servers.ok]', 'command = "npx"', '[mcp_servers.empty]', 'startup_timeout_sec = 5'].join('\n'),
  )
  const setup = discover(['api'])
  expect(setup.mcp.map((s) => s.name).sort()).toEqual(['docs', 'ok'])
  expect(setup.diagnostics.map((d) => d.message).sort()).toEqual([
    'Server "broken" has neither a url nor a command, so Ramu cannot share it.',
    'Server "empty" has neither a url nor a command, so Ramu cannot share it.',
  ])
})

describe('every project at once', () => {
  it('reads the person’s own servers with the all-projects choice and counts projects that chose differently', () => {
    put(join(home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { url: 'https://docs/mcp' } } }))
    const key = discoverProjectSetup(null, [], [], {}, {}, home).mcp[0]!.key
    const sharing = {
      [key]: true,
      [projectSharingKey('a', key)]: false,
      [projectSharingKey('b', key)]: false,
      [projectSharingKey('c', key)]: true,
    }
    const everywhere = discoverProjectSetup(null, [], [], sharing, {}, home).mcp[0]!
    expect(everywhere).toMatchObject({ shared: true, shareScope: 'host', exceptions: 2 })
    // Inside one project the count means nothing: that project's own choice is what applies there.
    const inA = discoverProjectSetup('a', [], [], sharing, {}, home).mcp[0]!
    expect(inA).toMatchObject({ shared: false, shareScope: 'project' })
    expect(inA.exceptions).toBeUndefined()
  })
})
