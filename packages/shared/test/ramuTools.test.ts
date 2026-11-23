import { describe, expect, it } from 'vitest'
import { describeRamuTool, ramuTool, ramuToolHasOwnUi, summarizeAgentStatuses } from '../src/chat/ramuTools'

const use = (name: string, input?: unknown, summary = '') => ({
  name,
  summary: summary || (input ? JSON.stringify(input) : ''),
  ...(input ? { input: JSON.stringify(input, null, 2) } : {}),
})

describe('Ramu tool calls', () => {
  it('recognises each provider’s naming', () => {
    expect(ramuTool(use('mcp__ramu__memory_search', { query: 'tabs' }))).toEqual({
      name: 'memory_search',
      args: { query: 'tabs' },
    })
    expect(ramuTool({ name: 'memory_search', summary: 'ramu', input: '{"query":"tabs"}' })?.name).toBe('memory_search')
    expect(ramuTool(use('ramu_skill_inspect', { id: 's1' }))?.name).toBe('skill_inspect')
    expect(ramuTool(use('ramu_tools_skill_inspect', { id: 's1' }))?.name).toBe('skill_inspect')
    expect(ramuTool(use('memory_search', { query: 'x' }))).toBeNull()
    expect(ramuTool(use('mcp__other__memory_search'))).toBeNull()
    expect(ramuTool(use('mcp__ramu__made_up'))).toBeNull()
  })

  it('reads ci_setup as writing the workflow, or reading it when it existed', () => {
    const call = ramuTool(use('mcp__ramu__ci_setup', {}))!
    const wrote = describeRamuTool(call, JSON.stringify({ path: '.github/workflows/ci.yml', written: true }))
    expect(wrote.done).toBe('Wrote the CI workflow')
    expect(wrote.subject).toBe('.github/workflows/ci.yml')
    expect(describeRamuTool(call, JSON.stringify({ path: '.gitlab-ci.yml', written: false })).done).toBe(
      'Read the CI workflow',
    )
  })

  it('reads each artifact tool as a row of its own', () => {
    for (const name of [
      'artifact_preview',
      'artifact_publish',
      'artifact_read',
      'artifact_versions',
      'artifact_list',
      'artifact_get',
      'artifact_records',
      'artifact_published',
      'artifact_run',
    ]) {
      const call = ramuTool(use(`mcp__ramu__${name}`, { title: 'Ledger' }))
      expect(call?.name, name).toBe(name)
      expect(describeRamuTool(call!).done, name).not.toBe('Used')
    }
    expect(
      describeRamuTool(ramuTool(use('mcp__ramu__artifact_records', { action: 'add', collection: 'rows' }))!),
    ).toEqual({
      icon: 'book',
      done: 'Added a record',
      running: 'Adding a record',
      subject: 'rows',
      facts: [],
    })
  })

  it('reads a script by the Shared MCP tools it called, most used first, and its failure', () => {
    const call = ramuTool(use('ramu_run_script', { code: 'return 1' }))!
    expect(call.name).toBe('run_script')
    expect(
      describeRamuTool(
        call,
        JSON.stringify({ result: [], calls: { 'linear-1a2b3c__list_issues': 10, 'linear-1a2b3c__get_issue': 117 } }),
      ),
    ).toEqual({
      icon: 'terminal',
      done: 'Ran a script',
      running: 'Running a script',
      subject: 'linear: get_issue ×117 · linear: list_issues ×10',
      facts: [{ label: 'Calls', value: '127' }],
    })
    expect(
      describeRamuTool(call, JSON.stringify({ error: 'Declined', calls: { 'sentry-abcdef__find': 1 } })).facts,
    ).toEqual([
      { label: 'Calls', value: '1' },
      { label: 'Failed', value: 'Declined' },
    ])
    expect(describeRamuTool(call).subject).toBeUndefined()
  })

  it('unwraps tool_invoke', () => {
    const call = ramuTool(
      use('mcp__ramu__tool_invoke', { name: 'memory_save', arguments: { title: 'Tabs', kind: 'user' } }),
    )
    expect(call).toEqual({ name: 'memory_save', args: { title: 'Tabs', kind: 'user' } })
    expect(ramuTool(use('mcp__ramu__tool_invoke', { name: 'tool_invoke', arguments: {} }))?.name).toBe('tool_invoke')
  })

  it('hides only calls that already have a place in the thread', () => {
    for (const name of [
      'ask_user',
      'wait_for_answer',
      'set_goal',
      'update_goal',
      'schedule_create',
      'ramu_agent',
      'advisor',
    ])
      expect(ramuToolHasOwnUi(use(`mcp__ramu__${name}`)), name).toBe(true)
    expect(ramuToolHasOwnUi(use('mcp__ramu__tool_invoke', { name: 'schedule_create', arguments: {} }))).toBe(true)
    for (const name of ['memory_save', 'skill_inspect', 'schedule_list', 'tool_search', 'message_parent'])
      expect(ramuToolHasOwnUi(use(`mcp__ramu__${name}`)), name).toBe(false)
    expect(ramuToolHasOwnUi(use('Bash', { command: 'ls' }))).toBe(false)
  })

  it('describes calls without raw JSON', () => {
    expect(
      describeRamuTool({
        name: 'memory_save',
        args: { title: 'Tabs', kind: 'user', scope: 'global', content: 'Uses tabs' },
      }),
    ).toMatchObject({ done: 'Saved memory', running: 'Saving memory', subject: '“Tabs”', icon: 'brain' })
    expect(
      describeRamuTool({ name: 'skill_inspect', args: { id: 's1' } }, JSON.stringify({ name: 'Release steps' }))
        .subject,
    ).toBe('“Release steps”')
    expect(describeRamuTool({ name: 'schedule_pause', args: { paused: false } }).done).toBe('Resumed a schedule')
    expect(describeRamuTool({ name: 'memory_read', args: { id: 'm1' } }, 'not json').subject).toBeUndefined()
  })

  it('summarises agent states', () => {
    expect(summarizeAgentStatuses(['running', 'completed', 'completed', 'failed'])).toBe(
      '1 running · 1 failed · 2 done',
    )
    expect(summarizeAgentStatuses([])).toBe('')
  })
})

describe('review thread library tools', () => {
  it('reads each edit as a sentence with its subject and reason', () => {
    const merged = describeRamuTool(
      { name: 'memory_merge', args: { ids: ['a', 'b'], title: 'Tabs', reason: 'Same preference' } },
      JSON.stringify({ kept: { title: 'Tabs' }, archived: ['b'] }),
    )
    expect(merged).toMatchObject({ done: 'Merged memories', subject: '“Tabs”' })
    expect(merged.facts).toContainEqual({ label: 'Merged', value: '2 notes into one' })
    const archived = describeRamuTool(
      { name: 'memory_archive', args: { id: 'a', reason: 'Outdated' } },
      JSON.stringify({ title: 'Old note' }),
    )
    expect(archived).toMatchObject({ done: 'Archived a memory', subject: '“Old note”' })
    expect(archived.facts.map((fact) => fact.label)).toEqual(['Why', 'Restore'])
    expect(
      describeRamuTool(
        { name: 'skill_update', args: { id: 's', reason: 'Clearer' } },
        JSON.stringify({ name: 'retry' }),
      ),
    ).toMatchObject({ done: 'Updated skill', subject: '“retry”' })
  })

  it('recognises the new tools under every provider naming', () => {
    for (const name of ['memory_restore', 'skill_archive', 'skill_restore', 'skill_inspect'])
      expect(ramuTool(use(`mcp__ramu__${name}`, { id: 'x' }))?.name).toBe(name)
  })
})

describe('protected edits in review threads', () => {
  it('marks a protected item changed at the user’s request, and only then', () => {
    const marked = describeRamuTool(
      { name: 'memory_update', args: { id: 'm', reason: 'Asked', userRequested: true, userRequest: 'reword it' } },
      JSON.stringify({ title: 'Tabs', protectedChange: true, userRequest: 'reword it' }),
    )
    expect(marked.facts.slice(0, 2)).toEqual([
      { label: 'Protected', value: 'Protected item changed at your request' },
      { label: 'You asked', value: '“reword it”' },
    ])
    const plain = describeRamuTool(
      { name: 'memory_update', args: { id: 'm', reason: 'r' } },
      JSON.stringify({ title: 'x' }),
    )
    expect(plain.facts.map((fact) => fact.label)).toEqual(['Why'])
    // A refused call returns an error text, never the mark.
    expect(
      describeRamuTool({ name: 'skill_update', args: { id: 's', userRequested: true } }, 'This skill is pinned').facts,
    ).toEqual([])
  })

  it('reads background command waits by what came of them', () => {
    const call = (args: Record<string, unknown>) => ramuTool(use('mcp__ramu__background_terminal_wait', args))!
    const waiting = describeRamuTool(call({ ids: ['a'], outputIncludes: ['ready'] }))
    expect(waiting.running).toBe('Waiting for output')
    const result = (value: unknown) => JSON.stringify(value)
    const saw = describeRamuTool(
      call({ ids: ['a'], outputIncludes: ['ready'] }),
      result({
        reason: 'matched',
        waitedMs: 4200,
        matched: { id: 'a', text: 'ready' },
        commands: [{ command: 'pnpm dev', state: 'running' }],
      }),
    )
    expect(saw).toMatchObject({ done: 'Saw', subject: '“ready”', icon: 'terminal' })
    expect(saw.facts).toEqual([
      { label: 'Command', value: 'pnpm dev' },
      { label: 'Waited', value: '4s' },
    ])
    const failed = describeRamuTool(
      call({ ids: ['a', 'b'], mode: 'all' }),
      result({
        reason: 'exited',
        waitedMs: 90_000,
        commands: [
          { command: 'pnpm lint', state: 'exited', exitCode: 0 },
          { command: 'pnpm test', state: 'failed', exitCode: 1 },
        ],
      }),
    )
    expect(failed).toMatchObject({ done: 'Background command failed', subject: 'pnpm lint, pnpm test' })
    expect(failed.facts).toContainEqual({ label: 'Exit code', value: '1' })
    expect(
      describeRamuTool(call({ ids: ['a'] }), result({ reason: 'timeout', waitedMs: 300_000, commands: [] })).done,
    ).toBe('Stopped waiting')
    expect(
      describeRamuTool(ramuTool(use('mcp__ramu__background_terminal_launch', { command: 'pnpm dev' }))!).subject,
    ).toBe('pnpm dev')
  })
})

it('reads a catalog call as the tool it ran, pull request tools included', () => {
  const call = ramuTool({
    name: 'mcp__ramu__tool_invoke',
    summary: '',
    input: JSON.stringify({ name: 'pull_request_reply', arguments: { pullRequest: 'https://x/pr/4', body: 'Fixed.' } }),
  })
  expect(call).toEqual({ name: 'pull_request_reply', args: { pullRequest: 'https://x/pr/4', body: 'Fixed.' } })
  expect(describeRamuTool(call!)).toMatchObject({ done: 'Replied on pull request', subject: '“Fixed.”' })
  // A tool this list does not name yet still reads as itself, not as tool_invoke.
  const unknown = ramuTool({
    name: 'mcp__ramu__tool_invoke',
    summary: '',
    input: JSON.stringify({ name: 'brand_new_tool', arguments: {} }),
  })
  expect(describeRamuTool(unknown!)).toMatchObject({ done: 'Used', subject: 'brand new tool' })
})
