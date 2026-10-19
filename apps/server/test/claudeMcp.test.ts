import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentSessionInfo } from '@ramu/shared/types'
import { claudeLaunchOptions } from '../src/agent/claudeOptions'
import { claudeMcpEnvironment, claudeMcpServers } from '../src/providers/claudeMcp'

let root: string
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value))
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-claude-mcp-'))
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

it('merges local MCPs and .mcp.json from every covered repo into a workspace without its own config', () => {
  const a = join(root, 'repo-a'),
    b = join(root, 'repo-b')
  mkdirSync(a)
  mkdirSync(b)
  write(join(a, '.mcp.json'), { mcpServers: { docs: { command: 'docs' }, shared: { command: 'repo' } } })
  write(join(b, '.mcp.json'), { mcpServers: { database: { command: 'database' } } })
  write(join(root, '.claude.json'), {
    projects: {
      [a]: {
        mcpServers: {
          'pentools-atlassian': { type: 'http', url: 'https://atlassian.example/mcp' },
          shared: { command: 'local' },
          ramu: { command: 'cannot-replace' },
        },
      },
      [b]: {
        mcpServers: { figma: { command: 'figma' }, disabled: { command: 'disabled' } },
        disabledMcpServers: ['disabled'],
      },
      '/unrelated': { mcpServers: { private: { command: 'private' } } },
    },
  })
  const servers = claudeMcpServers({ cwd: root, covers: [a, b], additionalDirs: [] }, [], { CLAUDE_CONFIG_DIR: root })
  expect(Object.keys(servers).sort()).toEqual(['database', 'docs', 'figma', 'pentools-atlassian', 'shared'])
  expect(servers.shared).toEqual({ command: 'local' })
})

it('loads original repository configuration for a worktree without crossing account boundaries', () => {
  const original = join(root, 'original'),
    task = join(root, 'task'),
    account = join(root, 'account')
  for (const dir of [original, task, account]) mkdirSync(dir)
  write(join(original, '.mcp.json'), { mcpServers: { docs: { command: 'original-docs' } } })
  write(join(root, '.claude.json'), {
    projects: { [original]: { mcpServers: { otherAccount: { command: 'private' } } } },
  })
  write(join(account, '.claude.json'), {
    projects: { [original]: { mcpServers: { atlassian: { command: 'atlassian' } } } },
  })
  expect(
    Object.keys(
      claudeMcpServers({ cwd: task, covers: [task], additionalDirs: [] }, [original], { CLAUDE_CONFIG_DIR: account }),
    ).sort(),
  ).toEqual(['atlassian', 'docs'])
})

it('keeps checkout definitions ahead of original repository definitions', () => {
  const original = join(root, 'original'),
    task = join(root, 'task')
  for (const dir of [original, task]) mkdirSync(dir)
  write(join(original, '.mcp.json'), { mcpServers: { docs: { command: 'original' } } })
  write(join(task, '.mcp.json'), { mcpServers: { docs: { command: 'checkout' } } })
  expect(
    claudeMcpServers({ cwd: root, covers: [task], additionalDirs: [] }, [original], { CLAUDE_CONFIG_DIR: root }).docs,
  ).toEqual({ command: 'checkout' })
})

it('does not discard repository MCPs when the local config is malformed', () => {
  write(join(root, '.mcp.json'), { mcpServers: { docs: { command: 'docs' } } })
  writeFileSync(join(root, '.claude.json'), 'invalid')
  expect(
    Object.keys(claudeMcpServers({ cwd: root, covers: [root], additionalDirs: [] }, [], { CLAUDE_CONFIG_DIR: root })),
  ).toEqual(['docs'])
})

it('waits for slow startup and retains explicit timeout choices', () => {
  expect(claudeMcpEnvironment({})).toMatchObject({ MCP_TIMEOUT: '60000', CLAUDE_CODE_MCP_STARTUP_WAIT_MS: '60000' })
  expect(claudeMcpEnvironment({ MCP_TIMEOUT: '120000', CLAUDE_CODE_MCP_STARTUP_WAIT_MS: '0' })).toMatchObject({
    MCP_TIMEOUT: '120000',
    CLAUDE_CODE_MCP_STARTUP_WAIT_MS: '0',
  })
})

it('passes repository-local servers and the startup wait into the Claude SDK launch', () => {
  vi.stubEnv('CLAUDE_CONFIG_DIR', root)
  const repo = join(root, 'repository')
  mkdirSync(repo)
  write(join(root, '.claude.json'), {
    projects: { [repo]: { mcpServers: { atlassian: { type: 'http', url: 'https://atlassian.example/mcp' } } } },
  })
  const options = claudeLaunchOptions({
    session: {
      cwd: root,
      additionalDirs: [],
      covers: [repo],
      settings: DEFAULT_AGENT_SETTINGS,
    } as unknown as AgentSessionInfo,
    connection: { url: 'http://localhost/mcp', token: 'ramu-token' },
    advisorModel: undefined,
    abort: new AbortController(),
    canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
    resume: null,
    preferences: undefined,
    hooks: undefined,
  })
  expect(options.mcpServers).toMatchObject({
    atlassian: { type: 'http', url: 'https://atlassian.example/mcp' },
    ramu: { type: 'http', url: 'http://localhost/mcp' },
  })
  expect(options.env).toHaveProperty('CLAUDE_CODE_MCP_STARTUP_WAIT_MS')
})
