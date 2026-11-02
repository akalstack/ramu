import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import { claudeHelperEvents, loadHelperHistory, helperRecoverySources } from '../src/agent/helperHistory'
import { getSubagentMessages, listSubagents, type SessionMessage } from '@anthropic-ai/claude-agent-sdk'

vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<object>()),
  getSubagentMessages: vi.fn(),
  listSubagents: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
})
const message = (type: SessionMessage['type'], uuid: string, content: unknown): SessionMessage => ({
  type,
  uuid,
  session_id: 'native-root',
  parent_tool_use_id: 'spawn',
  parent_agent_id: null,
  message: { content },
})
const session: AgentSessionInfo = {
  id: 'root',
  taskId: 't',
  provider: 'claude-code',
  settings: DEFAULT_AGENT_SETTINGS,
  state: 'restored',
  cwd: '/workspace',
  additionalDirs: [],
  covers: ['/workspace'],
  providerSessionId: 'native-root',
  parentId: null,
  createdAt: 0,
  title: 'Root',
}

describe('Claude saved helper history', () => {
  it('imports messages and tool evidence with stable IDs, excluding prompts and private reasoning', () => {
    expect(
      claudeHelperEvents('helper', [
        message('user', 'prompt', 'Inspect tests'),
        message('assistant', 'a', [
          { type: 'thinking', thinking: 'Private reasoning' },
          { type: 'text', text: 'Found suites' },
          { type: 'tool_use', id: 'tool', name: 'Read', input: { file_path: 'test.ts' } },
        ]),
        message('user', 'r', [
          {
            type: 'tool_result',
            tool_use_id: 'tool',
            content: [{ type: 'text', text: 'Three suites' }],
            is_error: false,
          },
        ]),
      ]),
    ).toEqual([
      { kind: 'text', agentId: 'helper', messageId: 'claude:a:1', text: 'Found suites' },
      { kind: 'tool-use', agentId: 'helper', toolUseId: 'tool', name: 'Read', summary: '{"file_path":"test.ts"}' },
      { kind: 'tool-result', agentId: 'helper', toolUseId: 'tool', isError: false, summary: 'Three suites' },
    ])
  })
  it('discovers missed helpers, reads each once, and retains failures beside other recovered histories', async () => {
    vi.mocked(listSubagents).mockResolvedValue(['known', 'missed'])
    vi.mocked(getSubagentMessages).mockImplementation(async (_session, id) => {
      if (id === 'missing') throw new Error('Transcript unavailable')
      return [message('assistant', id, 'Saved evidence')]
    })
    const history = await loadHelperHistory(session, [
      { agentId: 'known', name: 'Known', status: 'completed' },
      { agentId: 'missing', name: 'Missing', status: 'running' },
      { agentId: 'shell', name: 'Command', taskType: 'local_bash', status: 'running' },
    ])
    expect(history.map((entry) => entry.task.agentId)).toEqual(['known', 'missing', 'missed'])
    expect(history[0]?.task.status).toBe('completed')
    expect(history[1]?.error).toContain('Transcript unavailable')
    expect(history[2]?.events[0]).toMatchObject({ kind: 'text', agentId: 'missed' })
    expect(getSubagentMessages).toHaveBeenCalledTimes(3)
    expect(listSubagents).toHaveBeenCalledWith('native-root', { dir: '/workspace' })
  })
  it('joins a saved transcript to its task through the spawning tool ID when provider IDs differ', async () => {
    vi.mocked(listSubagents).mockResolvedValue(['native-agent'])
    vi.mocked(getSubagentMessages).mockImplementation(async (_session, id) =>
      id === 'task-id' ? [] : [message('assistant', 'saved', 'Recovered report')],
    )
    const history = await loadHelperHistory(session, [
      { agentId: 'task-id', toolUseId: 'spawn', name: 'Survey', status: 'running' },
    ])
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      task: { agentId: 'task-id', name: 'Survey' },
      events: [{ kind: 'text', agentId: 'task-id', text: 'Recovered report' }],
    })
    expect(history[0]?.error).toBeUndefined()
  })
})

describe('historical helper ownership', () => {
  it('partitions helpers across provider switches and repeat visits without reading a session twice', () => {
    const codex = { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' as const, model: 'codex-test' }
    const sources = helperRecoverySources(
      { ...session, provider: 'codex', settings: codex, providerSessionId: 'codex-new' },
      [
        { kind: 'init', provider: 'claude-code', providerSessionId: 'claude-old', model: 'claude', cwd: '/original' },
        { kind: 'agent', agentId: 'claude-helper', name: 'Claude helper', status: 'running' },
        { kind: 'settings', settings: codex, previous: DEFAULT_AGENT_SETTINGS, reason: 'Fallback', handoff: true },
        { kind: 'init', providerSessionId: 'codex-new', model: 'codex', cwd: '/workspace' },
        { kind: 'agent', agentId: 'codex-helper', name: 'Codex helper', status: 'completed' },
        { kind: 'init', providerSessionId: 'codex-new', model: 'codex', cwd: '/workspace' },
        { kind: 'agent', agentId: 'claude-helper', name: 'Claude helper', status: 'completed', recovered: true },
      ],
    )
    expect(sources).toHaveLength(2)
    expect(
      sources.map(({ session, tasks }) => [
        session.provider,
        session.providerSessionId,
        session.cwd,
        tasks.map((task) => [task.agentId, task.status]),
      ]),
    ).toEqual([
      ['claude-code', 'claude-old', '/original', [['claude-helper', 'completed']]],
      ['codex', 'codex-new', '/workspace', [['codex-helper', 'completed']]],
    ])
  })
  it('retains the original session of a missed helper discovered only after the provider switched', () => {
    const codex = { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' as const }
    const sources = helperRecoverySources(
      { ...session, provider: 'codex', settings: codex, providerSessionId: 'codex-new' },
      [
        { kind: 'init', provider: 'claude-code', providerSessionId: 'claude-old', model: 'claude', cwd: '/original' },
        { kind: 'settings', settings: codex, previous: DEFAULT_AGENT_SETTINGS, reason: 'Fallback', handoff: true },
        { kind: 'init', providerSessionId: 'codex-new', model: 'codex', cwd: '/workspace' },
        {
          kind: 'agent',
          agentId: 'discovered',
          name: 'Missed helper',
          status: 'stopped',
          recovered: true,
          provider: 'claude-code',
          providerSessionId: 'claude-old',
        },
      ],
    )
    expect(sources[0]?.tasks.map((task) => task.agentId)).toEqual(['discovered'])
    expect(sources[1]?.tasks).toEqual([])
  })
  it('infers legacy init providers from the first settings switch and retains history with no current native session', () => {
    const codex = { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' as const }
    const sources = helperRecoverySources({ ...session, provider: 'codex', settings: codex, providerSessionId: null }, [
      { kind: 'init', providerSessionId: 'claude-old', model: 'claude', cwd: '/workspace' },
      { kind: 'agent', agentId: 'old-helper', name: 'Old helper', status: 'running' },
      { kind: 'settings', settings: codex, previous: DEFAULT_AGENT_SETTINGS, reason: 'Fallback', handoff: true },
    ])
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      session: { provider: 'claude-code', providerSessionId: 'claude-old' },
      tasks: [{ agentId: 'old-helper' }],
    })
  })
})
