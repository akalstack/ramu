import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomAgent } from '@ramu/shared/customAgents'
import type { SharedMcpConnection } from '@ramu/shared/mcp'
import { DEFAULT_APP_PREFERENCES, type AppPreferences, type ManagedSkill } from '@ramu/shared/types'
import type { Rule, RuleInput } from '@ramu/shared/types/rules'
import { HostCredentialStore } from '../src/credentials/store'
import { pluginChanges, readPluginFolder, PluginReadError } from '../src/plugins/folder'
import { PluginService } from '../src/plugins/service'
import { safeGitUrl, signingKey, verifyCommit } from '../src/plugins/source'

const temp = () => mkdtempSync(join(tmpdir(), 'ramu-plugin-'))

function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const SKILL = '---\nname: render-deploy\ndescription: Deploy to Render.\n---\nRun render deploys.\n'

function renderPlugin(extra: Record<string, string> = {}, ramu: unknown = undefined) {
  return write(temp(), {
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'render',
      version: '1.0.0',
      description: 'Deploy to Render.',
      author: { name: 'Acme' },
      license: 'MIT',
      ...(ramu === undefined ? {} : { extensions: { 'dev.getramu': ramu } }),
    }),
    'skills/render-deploy/SKILL.md': SKILL,
    'skills/render-deploy/scripts/setup.sh': 'echo hi\n',
    '.mcp.json': JSON.stringify({
      mcpServers: {
        render: {
          command: '/usr/bin/env',
          args: ['node', '${CLAUDE_PLUGIN_ROOT}/server.js'],
          env: { RENDER_REGION: 'oregon', RENDER_KEY: '${RENDER_API_KEY}' },
        },
      },
    }),
    'agents/reviewer.md':
      '---\nname: render-reviewer\ndescription: Reviews render.yaml.\ntools: Read, Grep\n---\nCheck render.yaml.\n',
    'AGENTS.md': 'Prefer render.yaml blueprints.\n',
    'hooks/hooks.json': '{}',
    ...extra,
  })
}

const RAMU = {
  credentials: [
    {
      id: 'token',
      label: 'Render API key',
      env: 'RENDER_API_KEY',
      kind: 'token',
      page: 'https://dashboard.render.com/u/settings#api-keys',
      check: { request: { url: 'https://api.render.test/v1/owners' }, identity: '0.owner.email' },
    },
  ],
  cli: { binaries: ['render'], reads: [['services', 'list'], ['whoami']] },
  abilities: { web_search: { server: 'render', tool: 'search' } },
  dataSources: [
    {
      id: 'render',
      label: 'Render services',
      credential: 'token',
      request: { url: 'https://api.render.test/v1/services?limit={query.limit}' },
      query: [{ name: 'limit', type: 'number', min: 1, max: 100, default: 20 }],
      rows: { shape: 'objects', path: '' },
    },
  ],
}

function host(fetcher = vi.fn<typeof fetch>()) {
  const state = new Map<string, unknown>()
  const vault = new Map<string, string>()
  const skills: ManagedSkill[] = []
  const connections: SharedMcpConnection[] = []
  const secrets: { id: string; kind: string; name: string; value: string }[] = []
  let agents: CustomAgent[] = []
  const rules: Rule[] = []
  let preferences: AppPreferences = structuredClone(DEFAULT_APP_PREFERENCES)
  const service = new PluginService({
    getState: (key, fallback) => (state.has(key) ? (structuredClone(state.get(key)) as never) : fallback),
    setState: (key, value) => void state.set(key, structuredClone(value)),
    dir: temp(),
    ramuVersion: '0.2.0',
    skills: {
      list: () => skills,
      write: (skill) => {
        const at = skills.findIndex((entry) => entry.id === skill.id)
        if (at >= 0) skills[at] = skill
        else skills.push(skill)
      },
      remove: (id) =>
        void skills.splice(
          skills.findIndex((entry) => entry.id === id),
          1,
        ),
    },
    mcp: {
      connections: () => connections,
      save: (input, id) => {
        const saved = {
          ...input,
          id: id ?? `c${connections.length + 1}`,
          hostId: 'h',
          revision: 'r',
        } as SharedMcpConnection
        const at = connections.findIndex((entry) => entry.id === saved.id)
        if (at >= 0) connections[at] = saved
        else connections.push(saved)
        return saved
      },
      remove: (id) =>
        void connections.splice(
          connections.findIndex((entry) => entry.id === id),
          1,
        ),
      setSecret: async (id, kind, name, value) => void secrets.push({ id, kind, name, value }),
      splitFor: (id, identity) => {
        const found = connections.find((entry) => entry.split?.base === id && entry.split.identityId === identity)
        if (found) return found
        const base = connections.find((entry) => entry.id === id)!
        const split = { ...base, id: `${id}@${identity}`, split: { base: id, identityId: identity } }
        connections.push(split)
        return split
      },
    },
    identityOf: (projectId) => (projectId === 'work-api' ? 'work' : projectId ? 'personal' : null),
    agents: {
      list: () => agents,
      save: (input) => {
        const saved = { ...input, id: input.id ?? `a${agents.length + 1}`, updatedAt: 1 }
        agents = [...agents.filter((agent) => agent.id !== saved.id), saved]
        return saved
      },
      remove: (id) => void (agents = agents.filter((agent) => agent.id !== id)),
    },
    rules: {
      save: (input: RuleInput) => {
        const rule = { ...input, id: `r${rules.length + 1}`, revision: 1, createdAt: 1, updatedAt: 1 } as Rule
        rules.push(rule)
        return rule
      },
      remove: (id) =>
        void rules.splice(
          rules.findIndex((rule) => rule.id === id),
          1,
        ),
    },
    projects: () => [{ id: 'p1' }],
    preferences: { load: () => preferences, save: (next) => void (preferences = next) },
    changed: () => {},
    credentials: new HostCredentialStore(async (_service, key) => ({
      setPassword: async (value) => void vault.set(key, value),
      getPassword: async () => vault.get(key) ?? null,
      deletePassword: async () => vault.delete(key),
    })),
    fetch: fetcher,
  })
  return {
    service,
    state,
    vault,
    skills,
    connections,
    secrets,
    agents: () => agents,
    rules,
    preferences: () => preferences,
  }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

let services: PluginService[] = []
afterEach(() => {
  for (const service of services) service.close()
  services = []
})

describe('reading a plugin folder', () => {
  it('reads every part of the Claude Code layout and lists what Ramu does not run', () => {
    const folder = readPluginFolder(renderPlugin({}, RAMU))
    expect(folder.contents).toMatchObject({
      name: 'render',
      manifest: '.claude-plugin/plugin.json',
      skills: [{ name: 'render-deploy', scripts: ['scripts/setup.sh'] }],
      mcpServers: [{ name: 'render', type: 'stdio', envKeys: ['RENDER_REGION', 'RENDER_KEY'] }],
      agents: [{ name: 'render-reviewer', readOnly: true }],
      rule: { file: 'AGENTS.md' },
      unused: ['hooks'],
      cli: { binaries: ['render'], reads: ['services list', 'whoami'] },
      abilities: [{ ability: 'web_search', server: 'render', tool: 'search' }],
      problems: [],
    })
  })

  it('reads plugin.json first, then the Codex manifest', () => {
    const root = write(temp(), {
      '.codex-plugin/plugin.json': JSON.stringify({ name: 'codex-one' }),
      'plugin.json': JSON.stringify({ name: 'root-one' }),
    })
    expect(readPluginFolder(root).manifest.name).toBe('root-one')
    const codex = write(temp(), { '.codex-plugin/plugin.json': JSON.stringify({ name: 'codex-one' }) })
    expect(readPluginFolder(codex).contents.manifest).toBe('.codex-plugin/plugin.json')
  })

  it('names each problem with its file', () => {
    const folder = readPluginFolder(
      renderPlugin(
        { 'skills/wrong/SKILL.md': SKILL, 'agents/empty.md': 'no front matter' },
        { ...RAMU, abilities: { web_search: { server: 'missing', tool: 'search' } } },
      ),
    )
    const problems = folder.contents.problems.map((problem) => `${problem.file}: ${problem.message}`)
    expect(problems.some((line) => line.startsWith('skills/wrong/SKILL.md') && line.includes('same name'))).toBe(true)
    expect(problems.some((line) => line.includes('server missing'))).toBe(true)
    expect(problems.some((line) => line.startsWith('agents/empty.md'))).toBe(true)
  })

  it('refuses a folder with no manifest or an oversized one', () => {
    expect(() => readPluginFolder(temp())).toThrow(PluginReadError)
    const big = write(temp(), { 'plugin.json': JSON.stringify({ name: 'big', description: 'x'.repeat(70_000) }) })
    expect(() => readPluginFolder(big)).toThrow(/larger than/)
  })

  it('asks again for a changed MCP command or read-only prefix, not for skill wording', () => {
    const before = readPluginFolder(renderPlugin({}, RAMU)).fingerprint
    const wording = readPluginFolder(
      renderPlugin({ 'skills/render-deploy/SKILL.md': SKILL.replace('Run', 'Start') }, RAMU),
    ).fingerprint
    expect(pluginChanges(before, wording)).toEqual({ changes: ['Skill render-deploy changed'], needsApproval: false })
    const command = readPluginFolder(
      renderPlugin({ '.mcp.json': JSON.stringify({ mcpServers: { render: { command: '/bin/sh', args: [] } } }) }, RAMU),
    ).fingerprint
    expect(pluginChanges(before, command).needsApproval).toBe(true)
    const reads = readPluginFolder(
      renderPlugin({}, { ...RAMU, cli: { binaries: ['render'], reads: [['deploy']] } }),
    ).fingerprint
    expect(pluginChanges(before, reads)).toMatchObject({ needsApproval: true })
  })
})

describe('installing', () => {
  it('saves nothing until confirmed, then adds every part tagged with the plugin', async () => {
    const h = host()
    services.push(h.service)
    const review = await h.service.stage({ source: renderPlugin({}, RAMU) })
    expect(h.skills).toEqual([])
    expect(review.blocked).toBeNull()
    const plugin = await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    expect(h.skills[0]).toMatchObject({ name: 'render-deploy', installation: { source: 'plugin:render' } })
    expect(Object.keys(h.skills[0]!.installation!.files)).toEqual(['SKILL.md'])
    const connection = h.connections[0]!
    expect(connection).toMatchObject({ name: 'render', scope: { hostWide: true } })
    expect(connection.transport).toMatchObject({ type: 'stdio', command: '/usr/bin/env' })
    expect((connection.transport as { args: string[] }).args[1]).toMatch(/installed\/.+\/server\.js$/)
    expect(h.agents()[0]).toMatchObject({ name: 'render-reviewer', readOnly: true })
    expect(h.rules[0]).toMatchObject({ name: 'render plugin', activation: 'always' })
    expect(plugin.credentials).toEqual([
      { id: 'token', label: 'Render API key', state: 'missing', account: null, identities: [] },
    ])
    // A plain value reaches the server now; the credential's waits until it is saved.
    expect(h.secrets).toEqual([{ id: connection.id, kind: 'env', name: 'RENDER_REGION', value: 'oregon' }])
    expect(h.preferences().abilities.autoMcp?.web_search).toEqual({ connectionId: connection.id, tool: 'search' })
  })

  it('offers a 3D service’s mapping to Auto with its status tool, balance tool and download origins', async () => {
    const h = host()
    services.push(h.service)
    const review = await h.service.stage({
      source: renderPlugin(
        {},
        {
          ...RAMU,
          abilities: {
            model_3d: {
              server: 'render',
              tool: 'text_to_3d',
              status: 'task',
              balance: 'balance',
              downloads: ['https://assets.meshy.ai/'],
            },
          },
        },
      ),
    })
    await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    expect(h.preferences().abilities.autoMcp?.model_3d).toEqual({
      connectionId: h.connections[0]!.id,
      tool: 'text_to_3d',
      status: 'task',
      balance: 'balance',
      downloads: ['https://assets.meshy.ai'],
    })
  })

  it('refuses a download origin with a path', () => {
    const folder = readPluginFolder(
      renderPlugin(
        {},
        {
          ...RAMU,
          abilities: { model_3d: { server: 'render', tool: 'make', downloads: ['https://a.example.com/x'] } },
        },
      ),
    )
    expect(folder.contents.problems.map((problem) => problem.message).join(' ')).toContain('https origin')
  })

  it('refuses a second install of the same plugin and a plugin that needs a newer Ramu', async () => {
    const h = host()
    services.push(h.service)
    const first = await h.service.stage({ source: renderPlugin() })
    await h.service.confirm(first.stageId, { scope: { kind: 'all' }, includeScripts: true })
    await expect(h.service.stage({ source: renderPlugin() })).rejects.toThrow(/already installed/)
    const newer = await h.service.stage({
      source: write(temp(), {
        'plugin.json': JSON.stringify({
          name: 'newer',
          extensions: { 'dev.getramu': { requires: { ramu: '9.0.0' } } },
        }),
      }),
    })
    expect(newer.blocked).toMatch(/Ramu 9\.0\.0/)
    await expect(h.service.confirm(newer.stageId, { scope: { kind: 'all' }, includeScripts: false })).rejects.toThrow()
  })

  it('limits every part to one project', async () => {
    const h = host()
    services.push(h.service)
    const review = await h.service.stage({ source: renderPlugin() })
    await h.service.confirm(review.stageId, { scope: { kind: 'project', projectId: 'p1' }, includeScripts: false })
    expect(h.skills[0]!.projectId).toBe('p1')
    expect(h.connections[0]!.scope).toEqual({ hostWide: false, projectIds: ['p1'] })
    expect(h.service.forProject('p2')).toEqual([])
    expect(h.service.forProject('p1')).toHaveLength(1)
  })

  it('Remove leaves no skill, server, agent, rule, credential or ability behind', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json([{ owner: { email: 'ada@acme.test' } }]))
    const h = host(fetcher)
    services.push(h.service)
    const review = await h.service.stage({ source: renderPlugin({}, RAMU) })
    const plugin = await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    await h.service.setCredential(plugin.id, 'token', { token: 'rnd_secret', fields: {} })
    expect(h.vault.size).toBe(1)
    await h.service.remove(plugin.id)
    expect([h.skills, h.connections, h.agents(), h.rules, h.service.list()]).toEqual([[], [], [], [], []])
    expect(h.vault.size).toBe(0)
    expect(h.preferences().abilities.autoMcp?.web_search).toBeUndefined()
  })
})

describe('credentials', () => {
  it('checks a token before keeping it, names its account and gives it to the MCP server', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json([{ owner: { email: 'ada@acme.test' } }]))
    const h = host(fetcher)
    services.push(h.service)
    const review = await h.service.stage({ source: renderPlugin({}, RAMU) })
    const plugin = await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    const saved = await h.service.setCredential(plugin.id, 'token', { token: 'rnd_secret', fields: {} })
    expect(saved.credentials[0]).toMatchObject({ state: 'saved', account: 'ada@acme.test' })
    const init = fetcher.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer rnd_secret')
    expect(h.secrets).toContainEqual(expect.objectContaining({ name: 'RENDER_API_KEY', value: 'rnd_secret' }))
    expect(h.secrets).toContainEqual(expect.objectContaining({ name: 'RENDER_KEY', value: 'rnd_secret' }))
    // The token is in the credential store only, never in ordinary state.
    expect(JSON.stringify([...h.state.values()])).not.toContain('rnd_secret')
  })

  it('keeps nothing when the check is refused, and never repeats the token in the error', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('bad token rnd_secret', { status: 500 }))
    const h = host(fetcher)
    services.push(h.service)
    const review = await h.service.stage({ source: renderPlugin({}, RAMU) })
    const plugin = await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    const error = await h.service
      .setCredential(plugin.id, 'token', { token: 'rnd_secret', fields: {} })
      .catch((e: Error) => e)
    expect(String(error)).not.toContain('rnd_secret')
    expect(h.vault.size).toBe(0)
  })

  it('renews a sign-in before it expires', async () => {
    let issued = 0
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/token')
        ? json({
            access_token: `at_${++issued}`,
            refresh_token: 'rt',
            instance_url: 'https://acme.my.sf.test',
            expires_in: 1,
          })
        : json({}),
    )
    const h = host(fetcher)
    services.push(h.service)
    const root = write(temp(), {
      'plugin.json': JSON.stringify({
        name: 'sales',
        extensions: {
          'dev.getramu': {
            credentials: [
              {
                id: 'org',
                label: 'Salesforce',
                env: 'SF_TOKEN',
                kind: 'sign-in',
                signIn: {
                  authorizeUrl: 'https://login.sf.test/authorize',
                  tokenUrl: 'https://login.sf.test/token',
                  scopes: ['api'],
                  instanceField: 'instance_url',
                },
              },
            ],
          },
        },
      }),
    })
    const review = await h.service.stage({ source: root })
    const plugin = await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    const started = await h.service.startSignIn(plugin.id, 'org', {
      clientId: 'client',
      sandbox: false,
      redirectUri: 'http://localhost:7417/plugin/callback',
    })
    const url = new URL(started.url)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    await h.service.completeSignIn(started.state, 'code')
    const renewed = await h.service.secret(plugin.id, 'org')
    // A one-second token is renewed on every read: never the first one again.
    expect(renewed).toMatchObject({ fields: { instance: 'https://acme.my.sf.test' } })
    expect(renewed!.token).toBe(`at_${issued}`)
    expect(issued).toBeGreaterThan(1)
    const body = String(fetcher.mock.calls.at(-1)![1]!.body)
    expect(body).toContain('grant_type=refresh_token')
  })
})

describe('a credential split per identity', () => {
  it('keeps a second value for one identity, used by its projects and its own account on the MCP server', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json([{ owner: { email: 'someone@example.com' } }]))
    const h = host(fetcher)
    services.push(h.service)
    const review = await h.service.stage({ source: renderPlugin({}, RAMU) })
    const plugin = await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    await h.service.setCredential(plugin.id, 'token', { token: 'personal-token', fields: {} })
    const split = await h.service.setCredential(plugin.id, 'token', { token: 'work-token', fields: {} }, 'work')
    expect(split.credentials[0]!.identities).toEqual(['work'])
    expect((await h.service.secret(plugin.id, 'token', 'work-api'))!.token).toBe('work-token')
    expect((await h.service.secret(plugin.id, 'token', 'blog'))!.token).toBe('personal-token')
    const workAccount = h.connections.find((entry) => entry.split?.identityId === 'work')!
    expect(h.secrets).toContainEqual(
      expect.objectContaining({ id: workAccount.id, name: 'RENDER_API_KEY', value: 'work-token' }),
    )
    expect(h.secrets.filter((entry) => entry.id === workAccount.id).map((entry) => entry.value)).not.toContain(
      'personal-token',
    )
    await h.service.removeCredential(plugin.id, 'token', 'work')
    expect((await h.service.secret(plugin.id, 'token', 'work-api'))!.token).toBe('personal-token')
  })
})

describe('data sources', () => {
  it('queries only the origin the plugin names, with the fields it allows', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/owners')
        ? json([{ owner: { email: 'ada@acme.test' } }])
        : json([{ name: 'web', type: 'web_service', id: 'srv' }]),
    )
    const h = host(fetcher)
    services.push(h.service)
    const review = await h.service.stage({ source: renderPlugin({}, RAMU) })
    const plugin = await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    await h.service.setCredential(plugin.id, 'token', { token: 'rnd_secret', fields: {} })
    expect(await h.service.query('render', { limit: 5 }, ['name', 'type'], 100)).toEqual([
      { name: 'web', type: 'web_service' },
    ])
    expect(String(fetcher.mock.calls.at(-1)![0])).toBe('https://api.render.test/v1/services?limit=5')
    await expect(h.service.query('render', { limit: 500 }, ['name'], 100)).rejects.toThrow(/above 100/)
    await expect(h.service.query('render', { host: 'evil.test' }, ['name'], 100)).rejects.toThrow(/not a field/)
    await expect(h.service.query('grafana', {}, ['name'], 100)).rejects.toThrow(/No installed plugin/)
  })

  it('reaches a url field’s origin only', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ ok: true }))
    const h = host(fetcher)
    services.push(h.service)
    const root = write(temp(), {
      'plugin.json': JSON.stringify({
        name: 'graf',
        extensions: {
          'dev.getramu': {
            credentials: [
              {
                id: 'sa',
                label: 'Grafana token',
                env: 'GRAFANA_TOKEN',
                kind: 'token',
                fields: [{ id: 'url', label: 'Address', env: 'GRAFANA_URL', kind: 'url' }],
              },
            ],
            dataSources: [
              {
                id: 'grafana',
                label: 'Grafana',
                credential: 'sa',
                readOnly: true,
                request: {
                  method: 'POST',
                  url: '{field.url}/api/ds/query',
                  body: { queries: [{ expr: '{query.expr}' }] },
                },
                query: [{ name: 'expr', type: 'string' }],
                rows: { shape: 'objects', path: 'rows' },
              },
            ],
          },
        },
      }),
    })
    const review = await h.service.stage({ source: root })
    const plugin = await h.service.confirm(review.stageId, { scope: { kind: 'all' }, includeScripts: false })
    await h.service.setCredential(plugin.id, 'sa', {
      token: 'glsa',
      fields: { url: 'https://acme.grafana.test/some/path' },
    })
    await h.service.query('grafana', { expr: 'up' }, ['x'], 10)
    const [url, init] = fetcher.mock.calls.at(-1)!
    expect(String(url)).toBe('https://acme.grafana.test/api/ds/query')
    expect(JSON.parse(String(init!.body))).toEqual({ queries: [{ expr: 'up' }] })
    await expect(
      h.service.setCredential(plugin.id, 'sa', { token: 'glsa', fields: { url: 'http://acme.grafana.test' } }),
    ).rejects.toThrow(/https/)
  })
})

describe('sources', () => {
  it('installs only from https, ssh or a local path', () => {
    expect(safeGitUrl('https://github.com/acme/render-plugin')).toBe(true)
    expect(safeGitUrl('git@github.com:acme/render-plugin.git')).toBe(true)
    expect(safeGitUrl('ext::sh -c touch% /tmp/pwned')).toBe(false)
    expect(safeGitUrl('file:///etc')).toBe(false)
    expect(safeGitUrl('-uhelp')).toBe(false)
  })

  it('accepts a commit signed by the named key and refuses one signed by another', async () => {
    const dir = temp()
    const key = join(dir, 'key')
    const other = join(dir, 'other')
    try {
      execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-f', key])
      execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-f', other])
    } catch {
      return // No ssh-keygen on this machine.
    }
    const repo = write(temp(), { 'plugin.json': '{"name":"signed"}' })
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })
        .toString()
        .trim()
    git('init', '-q')
    git('add', '.')
    git(
      '-c',
      'user.name=Ada',
      '-c',
      'user.email=ada@acme.test',
      '-c',
      'gpg.format=ssh',
      '-c',
      `user.signingkey=${key}`,
      'commit',
      '-q',
      '-S',
      '-m',
      'signed',
    )
    const commit = git('rev-parse', 'HEAD')
    expect(await verifyCommit(repo, commit, signingKey(readFileSync(`${key}.pub`, 'utf8')))).toBe(true)
    expect(await verifyCommit(repo, commit, signingKey(readFileSync(`${other}.pub`, 'utf8')))).toBe(false)
  })
})
