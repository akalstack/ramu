import { describe, expect, it, vi } from 'vitest'
import type { ToolSyncStatus, WaitingTool } from '@ramu/shared/toolSync'
import { toolsCommand, type ToolsCall } from '../src/toolsCli'

const docs: WaitingTool = {
  key: 'mcp:docs',
  from: 'laptop',
  receivedAt: 1,
  state: 'new',
  tool: {
    kind: 'mcp',
    name: 'docs',
    transport: { type: 'http', url: 'https://docs.example.com/mcp', headers: ['Authorization'] },
    providers: ['claude-code'],
    tools: { search: 'allow' },
  },
}
const notes: WaitingTool = {
  key: 'skill:notes',
  from: 'laptop',
  receivedAt: 1,
  state: 'remove',
  remove: true,
  tool: { kind: 'skill', name: 'notes', description: 'Notes', source: null, content: 'Write notes.' },
}

function host(answers: Record<string, unknown>) {
  const calls: [string, unknown[]][] = []
  const call = vi.fn(async (method: string, args: unknown[] = []) => {
    calls.push([method, args])
    return answers[method]
  }) as unknown as ToolsCall
  const lines: string[] = []
  const io = {
    print: (line: string) => void lines.push(line),
    confirm: vi.fn(async () => true),
    secret: vi.fn(async () => 'Bearer secret'),
  }
  return { call, calls, lines, io }
}

const status = (waiting: WaitingTool[]) => ({ waiting }) as unknown as ToolSyncStatus

describe('ramu tools', () => {
  it('lists what other hosts sent, each with the command that handles it', async () => {
    const { call, lines, io } = host({ 'toolSync.status': status([docs, notes]) })
    await toolsCommand('list', undefined, call, io)
    expect(lines).toEqual([
      'docs (MCP server) from laptop: ramu tools install docs',
      'notes (skill) removed on laptop: ramu tools remove notes',
    ])
  })

  it('adds a server, takes its secret without printing it, and turns it on as on its other host', async () => {
    const { call, calls, lines, io } = host({
      'toolSync.status': status([docs]),
      'toolSync.addServer': { connection: { id: 'c1', providers: ['claude-code'] }, secrets: ['Authorization'] },
      'settings.app.get': { providerBinaries: {} },
    })
    await toolsCommand('install', 'docs', call, io)
    expect(calls.map(([method]) => method)).toContain('mcp.setSecret')
    expect(calls.find(([method]) => method === 'mcp.setSecret')![1]).toEqual([
      'c1',
      'header',
      'Authorization',
      'Bearer secret',
    ])
    expect(lines.join('\n')).not.toContain('Bearer secret')
    expect(lines.join('\n')).toContain('Tools on there: search')
  })

  it('removes a skill its other host removed, only after a yes', async () => {
    const { call, calls, io } = host({
      'toolSync.status': status([notes]),
      'learning.get': { skills: [{ id: 's1', name: 'notes', projectId: null }] },
    })
    io.confirm.mockResolvedValueOnce(false)
    await toolsCommand('remove', 'notes', call, io)
    expect(calls.some(([method]) => method === 'skills.remove')).toBe(false)
    await toolsCommand('remove', 'notes', call, io)
    expect(calls.find(([method]) => method === 'skills.remove')![1]).toEqual(['s1'])
  })

  it('says what to type when the name matches nothing waiting', async () => {
    const { call, io } = host({ 'toolSync.status': status([docs]) })
    await expect(toolsCommand('install', 'nope', call, io)).rejects.toThrow('ramu tools lists what is')
  })
})
