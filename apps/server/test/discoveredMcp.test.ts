import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  acpMcpServers,
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
afterEach(() => rmSync(root, { recursive: true, force: true }))
const scope = () => ({ cwd: root, additionalDirs: [], covers: [join(root, 'repo')] })

it('skips servers with names providers cannot use as config keys', () => {
  expect(repoMcpServers(scope()).map((s) => s.name)).toEqual(['db', 'docs'])
})
it('converts repository servers for every provider', () => {
  const servers = repoMcpServers(scope())
  expect(codexMcpConfig(servers)).toEqual([
    'mcp_servers.db.command="db-mcp"',
    'mcp_servers.db.args=["--x"]',
    'mcp_servers.db.env={"TOKEN"="a\\"b"}',
    'mcp_servers.docs.url="https://docs"',
    'mcp_servers.docs.http_headers={"Authorization"="Bearer t"}',
  ])
  expect(acpMcpServers(servers, true).map((s) => s.name)).toEqual(['db', 'docs'])
  expect(acpMcpServers(servers, false).map((s) => s.name)).toEqual(['db'])
  expect(openCodeMcpServers(servers).db).toEqual({
    type: 'local',
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
