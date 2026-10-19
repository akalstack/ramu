import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  acpMcpServers,
  configuredMcpStatus,
  codexMcpConfig,
  cursorMcpServers,
  openCodeMcpServers,
  repoMcpServers,
} from '../src/providers/discoveredMcp'
import { openCodeServerEnv } from '../src/providers/opencode'

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-mcp-')))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  writeFileSync(
    join(repo, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        db: { command: 'db-mcp', args: ['--x'], env: { TOKEN: 'a"b' } },
        docs: { type: 'http', url: 'https://docs', headers: { Authorization: 'Bearer t' } },
        'bad name': { command: 'nope' },
      },
    }),
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})
const scope = () => ({ cwd: root, additionalDirs: [], covers: [join(root, 'repo')] })

it('skips servers with names providers cannot use as config keys', () => {
  expect(repoMcpServers(scope()).map((s) => s.name)).toEqual(['db', 'docs'])
})
it('converts repository servers for every provider', () => {
  const servers = repoMcpServers(scope())
  expect(codexMcpConfig(servers)).toEqual([
    'mcp_servers.db.startup_timeout_sec=60',
    'mcp_servers.db.command="db-mcp"',
    'mcp_servers.db.args=["--x"]',
    'mcp_servers.db.env={"TOKEN"="a\\"b"}',
    'mcp_servers.docs.startup_timeout_sec=60',
    'mcp_servers.docs.url="https://docs"',
    'mcp_servers.docs.http_headers={"Authorization"="Bearer t"}',
  ])
  expect(acpMcpServers(servers, true).map((s) => s.name)).toEqual(['db', 'docs'])
  expect(acpMcpServers(servers, false).map((s) => s.name)).toEqual(['db'])
  expect(openCodeMcpServers(servers).db).toEqual({
    type: 'local',
    timeout: { startup: 60000 },
    command: ['db-mcp', '--x'],
    environment: { TOKEN: 'a"b' },
  })
  expect(cursorMcpServers(servers).docs).toMatchObject({ type: 'http', url: 'https://docs' })
})
it('keeps the user config and Ramu server ahead of repository servers in OpenCode', () => {
  const connection = { url: 'http://x/mcp', token: 't' } as never
  const env = openCodeServerEnv(
    connection,
    JSON.stringify({ mcp: { servers: { db: { type: 'remote', url: 'https://mine' } } } }),
    openCodeMcpServers(repoMcpServers(scope())),
  )
  const servers = JSON.parse(env.OPENCODE_CONFIG_CONTENT!).mcp.servers
  expect(servers.db.url).toBe('https://mine')
  expect(Object.keys(servers).sort()).toEqual(['db', 'docs', 'ramu'])
})

it('uses original repository MCPs for every provider while keeping checkout definitions first', () => {
  const original = join(root, 'repo'),
    checkout = join(root, 'checkout')
  mkdirSync(checkout)
  writeFileSync(join(checkout, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'checkout-db' } } }))
  const servers = repoMcpServers({ cwd: root, additionalDirs: [], covers: [checkout] }, [original])
  expect(servers.find((s) => s.name === 'db')?.command).toBe('checkout-db')
  expect(servers.find((s) => s.name === 'docs')?.url).toBe('https://docs')
  for (const converted of [
    codexMcpConfig(servers),
    acpMcpServers(servers, true),
    Object.keys(cursorMcpServers(servers)),
    Object.keys(openCodeMcpServers(servers)),
  ]) {
    expect(converted.length).toBeGreaterThan(1)
  }
  const status = configuredMcpStatus(
    { cwd: checkout, additionalDirs: [], covers: [checkout] },
    { url: 'http://localhost/mcp', token: 'secret', mcpConfigDirs: [original] },
    false,
  )
  expect(status.servers).toEqual([
    { name: 'db', status: 'configured' },
    { name: 'docs', status: 'unsupported' },
    { name: 'ramu', status: 'unsupported' },
  ])
  expect(JSON.stringify(status)).not.toContain('secret')
})

it('shares Claude-local repository MCPs across providers without unrelated project servers', () => {
  vi.stubEnv('CLAUDE_CONFIG_DIR', root)
  const original = join(root, 'repo')
  writeFileSync(
    join(root, '.claude.json'),
    JSON.stringify({
      projects: {
        [original]: {
          mcpServers: {
            'pentools-atlassian': {
              type: 'http',
              url: 'https://atlassian.example/mcp',
              headers: { Authorization: 'Bearer example' },
            },
          },
        },
        '/unrelated': { mcpServers: { private: { command: 'private' } } },
      },
    }),
  )
  const servers = repoMcpServers({ cwd: root, covers: [], additionalDirs: [] }, [original])
  expect(servers.map((server) => server.name)).toContain('pentools-atlassian')
  expect(servers.map((server) => server.name)).not.toContain('private')
  expect(codexMcpConfig(servers)).toContain('mcp_servers.pentools-atlassian.url="https://atlassian.example/mcp"')
  expect(openCodeMcpServers(servers)['pentools-atlassian']).toMatchObject({
    type: 'remote',
    url: 'https://atlassian.example/mcp',
  })
  expect(cursorMcpServers(servers)['pentools-atlassian']).toMatchObject({
    type: 'http',
    url: 'https://atlassian.example/mcp',
  })
  expect(acpMcpServers(servers, true).some((server) => server.name === 'pentools-atlassian')).toBe(true)
})

it('retains explicit startup timeouts when converting shared MCP definitions', () => {
  writeFileSync(
    join(root, 'repo', '.mcp.json'),
    JSON.stringify({ mcpServers: { slow: { command: 'slow-mcp', startup_timeout_sec: 120 } } }),
  )
  const servers = repoMcpServers(scope())
  expect(codexMcpConfig(servers)).toContain('mcp_servers.slow.startup_timeout_sec=120')
  expect(openCodeMcpServers(servers).slow?.timeout.startup).toBe(120000)
})
