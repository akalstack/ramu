import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_INTELLIGENCE_PREFERENCES,
  NO_PROJECT,
  type AgentSessionInfo,
  type ManagedSkill,
} from '@ramu/shared/types'
import type { AgentService } from '../src/agent'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { MemoryService } from '../src/memory/memory'
import { LearningService } from '../src/memory/learning'
import {
  REVIEW_SUFFIX,
  SETTLE_MS,
  SUMMARY_INTERVALS,
  SummaryService,
  changedByYouLine,
  composeSummary,
  deriveChangeLog,
  plainSummary,
  registerLibraryTools,
  seedPrompt,
  summaryPrompt,
  withoutTools,
} from '../src/memory/summaries'

const DAY = 86_400_000
const agent = { actor: 'agent', provider: 'codex', sessionId: 's', taskId: 't' } as const
const note = (title: string, content = `${title} body`) => ({
  projectId: null,
  kind: 'feedback' as const,
  title,
  content,
  tags: [],
  importance: 3,
})
const skillOf = (id: string, over: Partial<ManagedSkill> = {}): ManagedSkill => ({
  id,
  projectId: null,
  name: `skill-${id}`,
  description: `Describes ${id}`,
  content: `Do ${id} carefully.`,
  status: 'active',
  pinned: false,
  revision: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastUsedAt: null,
  useCount: 0,
  sourceSessionId: 's',
  sourceSeq: 5,
  changedBy: 'learning',
  ...over,
})

let db: Db,
  root: string,
  workspace: Workspace,
  memory: MemoryService,
  learning: LearningService,
  service: SummaryService
let analyze: ReturnType<typeof vi.fn<AgentService['analyze']>>, startReviewed: ReturnType<typeof vi.fn>
let created: (string | null)[]
let start: number

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-summaries-'))
  db = openDb(':memory:')
  workspace = new Workspace(db, join(root, 'worktrees'))
  analyze = vi.fn<AgentService['analyze']>(async () => ({
    message: JSON.stringify({
      headline: 'Ramu saved one note and a skill.',
      sections: [
        { theme: 'new-memories', text: 'A note about tabs.' },
        { theme: 'new-skills', text: 'A retry skill.' },
        { theme: 'archived', text: 'Nothing was archived.' },
      ],
      worthALook: [
        { id: 'unknown-id', reason: 'invented' },
        { id: 'sk1', reason: 'Quite broad' },
      ],
    }),
    provider: 'codex',
    model: 'test',
  }))
  startReviewed = vi.fn(async (taskId: string) => ({ id: `session-${taskId}`, taskId }))
  workspace.setAppState('app-preferences', {
    intelligence: { ...DEFAULT_INTELLIGENCE_PREFERENCES, summaryInterval: 'weekly' },
  })
  memory = new MemoryService(db, workspace, { analyze, list: () => [] }, () => {})
  learning = new LearningService(
    db,
    workspace,
    { get: () => ({}) as AgentSessionInfo, events: () => [], analyze },
    memory,
    join(root, 'skills'),
    () => {},
  )
  created = []
  service = new SummaryService(db, workspace, { analyze, startReviewed } as never, memory, learning, (id) =>
    created.push(id),
  )
  start = Date.now() - 1000
})
afterEach(async () => {
  await service.settle()
  db.close()
  rmSync(root, { recursive: true, force: true })
})

const log = (include = { memory: true, skills: true }) =>
  deriveChangeLog(db, learning.jobs(), start, Date.now() + 1000, include)

describe('change log', () => {
  it('derives learned changes from memory events and skill revisions since the previous summary', () => {
    const a = memory.save(note('Prefer tabs'), agent).memory
    const b = memory.save(note('Old unrelated note'), agent).memory
    memory.archive(b.id, { actor: 'dream' }, 'stale: unused for 90 days')
    learning.write(skillOf('sk1'))
    const result = log()
    expect(result.learned.map((item) => [item.kind, item.title, item.change])).toEqual(
      expect.arrayContaining([
        ['memory', 'Prefer tabs', 'added'],
        ['memory', 'Old unrelated note', 'archived'],
        ['skill', 'skill-sk1', 'added'],
      ]),
    )
    expect(result.learned.find((item) => item.id === b.id)?.reason).toContain('stale')
    expect(result.learned.find((item) => item.id === a.id)?.detail).toBe('Prefer tabs body')
  })

  it('ignores changes before the period and honors the memory/skills switches', () => {
    memory.save(note('Prefer tabs'), agent)
    learning.write(skillOf('sk1'))
    expect(deriveChangeLog(db, [], Date.now() + 5, Date.now() + 10, { memory: true, skills: true }).learned).toEqual([])
    expect(log({ memory: false, skills: true }).learned.map((item) => item.kind)).toEqual(['skill'])
    expect(log({ memory: true, skills: false }).learned.map((item) => item.kind)).toEqual(['memory'])
  })

  it('counts your own edits instead of reporting them as learned', () => {
    const mine = memory.save(note('My preference'), { actor: 'user' }).memory
    const theirs = memory.save(note('Learned thing'), agent).memory
    memory.save({ ...note('Learned thing edited by me'), tags: [] }, { actor: 'user' }, theirs.id)
    learning.write(skillOf('sk1'))
    learning.control('sk1', 'pin')
    const result = log()
    expect(result.learned).toEqual([])
    expect(result.byYou).toEqual({ memories: 2, skills: 1 })
    expect(memory.get(mine.id).source.confirmed).toBe(true)
    expect(changedByYouLine(result)).toBe(
      'You changed 2 memories and 1 skill yourself; those are not counted as learned.',
    )
  })

  it('separates review thread edits from learning and tells cleanup from consolidation', () => {
    const a = memory.save(note('Reviewed note'), agent).memory
    memory.save(note('Reviewed note', 'Rewritten after discussion'), agent, a.id, `Clearer${REVIEW_SUFFIX}`)
    learning.write(skillOf('rev'))
    learning.write(skillOf('rev', { revision: 2, status: 'archived', changedBy: 'review', updatedAt: Date.now() + 1 }))
    learning.write(skillOf('old'))
    learning.write(skillOf('old', { revision: 2, status: 'archived', changedBy: 'cleanup', updatedAt: Date.now() + 1 }))
    const result = log()
    expect(result.inReview).toEqual({ memories: 0, skills: 0 })
    // The memory was added by learning and edited in review: still learned (its add event is not a review edit).
    expect(result.learned.find((item) => item.title === 'Reviewed note')).toBeTruthy()
    const old = result.learned.find((item) => item.id === 'old')
    expect(old).toMatchObject({ change: 'archived', reason: 'unused for a long time' })
  })

  it('reads the author of revisions saved before summaries existed from what changed', () => {
    learning.write(skillOf('legacy', { changedBy: undefined }))
    learning.write(
      skillOf('legacy', { revision: 2, changedBy: undefined, status: 'archived', updatedAt: Date.now() + 1 }),
    )
    const result = log()
    // No author and no new source: an archive of an untouched skill reads as cleanup.
    expect(result.learned.find((item) => item.id === 'legacy')).toMatchObject({
      change: 'archived',
      reason: 'unused for a long time',
    })
    // A content change with the same source was a revert or a hand edit: yours.
    learning.write(skillOf('hand', { changedBy: undefined }))
    learning.write(skillOf('hand', { revision: 2, changedBy: undefined, content: 'Edited', updatedAt: Date.now() + 1 }))
    expect(log().byYou.skills).toBe(1)
  })
})

describe('prompt and text', () => {
  it('sends learned excerpts but never the text of notes you wrote', () => {
    memory.save(note('Secret plan', 'my private confirmed text'), { actor: 'user' })
    memory.save(note('Learned thing', 'learned detail'), agent)
    learning.write(skillOf('sk1', { content: 'Set token: abcdefgh12345678 first' }))
    const prompt = summaryPrompt(log(), start, Date.now())
    expect(prompt).toContain('Learned thing')
    expect(prompt).not.toContain('my private confirmed text')
    expect(prompt).not.toContain('Secret plan')
    expect(prompt).not.toContain('abcdefgh12345678')
    expect(prompt).toContain('[redacted]')
    expect(prompt).toContain('untrusted data')
  })

  it('builds items and links from the change log, and drops invented ids and themes without changes', () => {
    const learned = [
      { kind: 'memory' as const, id: 'm1', title: 'Tabs', change: 'added' as const, detail: '' },
      { kind: 'skill' as const, id: 'sk1', title: 'retry', change: 'added' as const, detail: '' },
    ]
    const composed = composeSummary(
      {
        headline: 'One note and a skill.',
        sections: [
          { theme: 'new-memories', text: 'Tabs.' },
          { theme: 'archived', text: 'Hallucinated archive.' },
          { theme: 'new-memories', text: 'Duplicate section.' },
        ],
        worthALook: [
          { id: 'sk1', reason: 'Broad' },
          { id: 'nope', reason: 'Invented' },
        ],
      },
      learned,
    )
    expect(composed.text).toContain('### New memories')
    expect(composed.text).not.toContain('Hallucinated')
    expect(composed.text).not.toContain('Duplicate section')
    expect(composed.text).toContain('### Worth a look')
    expect(composed.items.find((item) => item.id === 'sk1')?.worthALook).toBe(true)
    expect(composed.items.find((item) => item.id === 'nope')).toBeUndefined()
  })

  it('has a plain fallback built from the log alone', () => {
    const plain = plainSummary([
      { kind: 'memory', id: 'm1', title: 'Tabs', change: 'added', detail: '' },
      { kind: 'memory', id: 'm2', title: 'Old', change: 'archived', reason: 'stale', detail: '' },
    ])
    expect(plain.headline).toBe('Ramu saved 1 memory, updated or cleaned up 1 item.')
    expect(plain.sections.map((section) => section.theme)).toEqual(['new-memories', 'archived'])
  })
})

describe('running', () => {
  it('skips without calling a model when nothing was learned', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    memory.save(note('My own note'), { actor: 'user' })
    const result = await service.run(true)
    expect(result).toEqual({ status: 'skipped', since: start })
    expect(analyze).not.toHaveBeenCalled()
    expect(service.snapshot().summaries).toEqual([])
    expect(workspace.getAppState('summaries-last-run-at', null)).toBe(start)
  })

  it('stores one entry per run with links, status and model, then starts the next period after it', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    memory.save(note('Prefer tabs'), agent)
    learning.write(skillOf('sk1'))
    const result = await service.run(true)
    expect(result.status).toBe('created')
    expect(created.filter(Boolean)).toHaveLength(1)
    const [summary] = service.snapshot().summaries
    expect(summary).toMatchObject({
      status: 'unread',
      headline: 'Ramu saved one note and a skill.',
      model: 'codex:test',
      periodStart: start,
      chatIds: [],
    })
    expect(summary!.items.map((item) => item.title).sort()).toEqual(['Prefer tabs', 'skill-sk1'])
    expect(summary!.items.find((item) => item.id === 'sk1')?.worthALook).toBe(true)
    expect(summary!.text).toContain('### New skills')
    expect(workspace.getAppState('summaries-last-run-at', 0)).toBe(summary!.periodEnd)
    // Nothing changed since: the next run is free.
    analyze.mockClear()
    expect((await service.run(true)).status).toBe('skipped')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('uses the maintenance model and falls back to a plain summary for unusable output', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    workspace.setAppState('app-preferences', {
      intelligence: {
        ...DEFAULT_INTELLIGENCE_PREFERENCES,
        maintenanceModel: { provider: 'opencode', model: 'small', effort: null },
      },
    })
    analyze.mockResolvedValue({ message: 'not json', provider: 'opencode', model: 'small' })
    memory.save(note('Prefer tabs'), agent)
    await service.run(true)
    expect(analyze.mock.calls[0]![1]).toMatchObject({ provider: 'opencode', model: 'small' })
    expect(analyze.mock.calls[0]![2]).toBe(30_000)
    expect(service.snapshot().summaries[0]!.headline).toBe('Ramu saved 1 memory.')
  })

  it('reports a failed model call and leaves the period open for the next try', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    memory.save(note('Prefer tabs'), agent)
    analyze.mockRejectedValue(new Error('provider down'))
    expect((await service.run(true)).status).toBe('busy')
    expect(service.snapshot()).toMatchObject({ error: 'provider down', summaries: [], lastRunAt: start })
  })

  it('manual runs wait for foreground threads', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    memory.save(note('Prefer tabs'), agent)
    db.exec(
      "INSERT INTO projects(id,name,created_at) VALUES ('p','P',1); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES ('t','p','T','current','idle',1); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES ('s','t','codex','/tmp','running',1)",
    )
    expect(await service.run(true)).toEqual({ status: 'busy' })
    expect(analyze).not.toHaveBeenCalled()
  })

  it('uses the input gate: unchanged input is skipped on schedule, Run now forces it, failures record nothing', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    memory.save(note('Prefer tabs'), agent)
    analyze.mockRejectedValueOnce(new Error('provider down'))
    expect((await service.run(true)).status).toBe('busy')
    expect(workspace.getAppState('input-gate:library-summary', null)).toBeNull()
    expect((await service.run(true)).status).toBe('created')
    expect(workspace.getAppState('input-gate:library-summary', null)).not.toBeNull()
    // Same period again: the change log and settings are unchanged.
    workspace.setAppState('summaries-last-run-at', start)
    analyze.mockClear()
    const scheduled = new SummaryService(db, workspace, { analyze, startReviewed } as never, memory, learning, () => {})
    expect(await scheduled.run(false)).toEqual({ status: 'skipped', since: start })
    expect(analyze).not.toHaveBeenCalled()
    workspace.setAppState('summaries-last-run-at', start)
    expect((await scheduled.run(true)).status).toBe('created')
    expect(analyze).toHaveBeenCalledTimes(1)
    await scheduled.settle()
  })

  it('marks summaries read and dismissed', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    memory.save(note('Prefer tabs'), agent)
    const { id } = (await service.run(true)) as { id: string }
    expect(service.read(id).status).toBe('read')
    service.dismiss(id)
    expect(service.get(id).status).toBe('dismissed')
    // Opening a dismissed summary does not bring it back.
    expect(service.read(id).status).toBe('dismissed')
  })
})

describe('scheduling', () => {
  const setInterval = (summaryInterval: 'off' | 'daily' | 'weekly') =>
    workspace.setAppState('app-preferences', { intelligence: { ...DEFAULT_INTELLIGENCE_PREFERENCES, summaryInterval } })

  it('does nothing while off, and starts the first period when first on', async () => {
    setInterval('off')
    await service.tick(1000)
    expect(workspace.getAppState('summaries-last-run-at', null)).toBeNull()
    setInterval('weekly')
    await service.tick(2000)
    expect(workspace.getAppState('summaries-last-run-at', null)).toBe(2000)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('runs after the interval and the settling delay, once', async () => {
    const t0 = Date.now()
    workspace.setAppState('summaries-last-run-at', t0 - SUMMARY_INTERVALS.weekly - 5000)
    memory.save(note('Prefer tabs'), agent)
    const now = Date.now()
    await service.tick(now)
    expect(analyze).not.toHaveBeenCalled()
    await service.tick(now + SETTLE_MS - 1)
    expect(analyze).not.toHaveBeenCalled()
    await service.tick(now + SETTLE_MS + 1)
    expect(analyze).toHaveBeenCalledTimes(1)
    await service.tick(now + SETTLE_MS + 5000)
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('weekly waits seven days and daily one', async () => {
    const last = Date.now() - 2 * DAY
    workspace.setAppState('summaries-last-run-at', last)
    memory.save(note('Prefer tabs'), agent)
    setInterval('weekly')
    await service.tick(Date.now())
    await service.tick(Date.now() + SETTLE_MS * 2)
    expect(analyze).not.toHaveBeenCalled()
    setInterval('daily')
    await service.tick(Date.now() + 1)
    await service.tick(Date.now() + SETTLE_MS * 2)
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while threads are running or learning is busy', async () => {
    workspace.setAppState('summaries-last-run-at', Date.now() - 8 * DAY)
    memory.save(note('Prefer tabs'), agent)
    db.exec(
      "INSERT INTO projects(id,name,created_at) VALUES ('p','P',1); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES ('t','p','T','current','idle',1); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES ('s','t','codex','/tmp','needs-input',1)",
    )
    const now = Date.now()
    await service.tick(now)
    await service.tick(now + SETTLE_MS * 3)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('scheduled skips advance the period without a model call', async () => {
    const last = Date.now() - 8 * DAY
    workspace.setAppState('summaries-last-run-at', last)
    const now = Date.now()
    await service.tick(now)
    await service.tick(now + SETTLE_MS + 1)
    expect(analyze).not.toHaveBeenCalled()
    expect(workspace.getAppState<number>('summaries-last-run-at', 0)).toBe(now + SETTLE_MS + 1)
  })
})

describe('discussing a summary', () => {
  it('starts a regular no-project thread in the most restrictive access mode, seeded and linked back', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    memory.save(note('Prefer tabs'), agent)
    const { id } = (await service.run(true)) as { id: string }
    const summary = service.get(id)
    const started = await service.discuss(id, 'Why did you save the tabs note?', {
      ...DEFAULT_AGENT_SETTINGS,
      access: 'full',
    })
    expect(started.sessionId).toBe(`session-${started.taskId}`)
    const [taskId, , prompt, settings] = startReviewed.mock.calls[0]!
    expect(taskId).toBe(started.taskId)
    expect(settings.access).toBe('edits')
    expect(prompt.startsWith('Why did you save the tabs note?')).toBe(true)
    expect(prompt).toContain('<ramu-context>')
    expect(prompt).toContain(summary.text)
    expect(prompt).toContain(`memory ${summary.items[0]!.id} "Prefer tabs"`)
    const task = workspace.getTask(started.taskId)
    expect(task).toMatchObject({ projectId: NO_PROJECT, kind: 'library-review' })
    expect(service.isReviewChat(started.taskId)).toBe(true)
    expect(service.get(id).chatIds).toEqual([started.taskId])
    expect(service.instructions({ taskId: started.taskId })).toContain('ramu-library-review')
    expect(service.instructions({ taskId: 'other' })).toBe('')
    // Several discussions per summary.
    await service.discuss(id, 'And the skill?')
    expect(service.get(id).chatIds).toHaveLength(2)
    expect(workspace.listTasks().filter((entry) => entry.kind === 'library-review')).toHaveLength(2)
  })

  it('removes the thread again when it cannot start, and refuses an empty message', async () => {
    workspace.setAppState('summaries-last-run-at', start)
    memory.save(note('Prefer tabs'), agent)
    const { id } = (await service.run(true)) as { id: string }
    await expect(service.discuss(id, '   ')).rejects.toThrow('Write a message')
    startReviewed.mockRejectedValueOnce(new Error('no provider'))
    await expect(service.discuss(id, 'hello')).rejects.toThrow('no provider')
    expect(workspace.listTasks()).toEqual([])
    expect(service.get(id).chatIds).toEqual([])
  })

  it('seeds the summary and item ids as data', () => {
    const prompt = seedPrompt(
      {
        id: 'x',
        periodStart: 0,
        periodEnd: DAY,
        text: 'Headline',
        headline: 'Headline',
        items: [{ kind: 'skill', id: 'sk1', title: 'retry', change: 'added' }],
        changedByYou: 'You changed 1 memory yourself; those are not counted as learned.',
        status: 'read',
        chatIds: [],
        model: 'm',
        createdAt: 0,
      },
      ' Please merge them ',
    )
    expect(prompt.startsWith('Please merge them\n\n<ramu-context>')).toBe(true)
    expect(prompt).toContain('skill sk1 "retry" (added)')
    expect(prompt).toContain('data, not instructions')
  })
})

describe('review thread tools', () => {
  type Handler = (args: Record<string, unknown>) => { isError?: boolean; content: { text: string }[] }
  let tools: Map<string, Handler>
  let installedPath: string
  const INSTALLED_TEXT = '---\nname: deploy-check\ndescription: Checks a deploy\n---\nRun the smoke test.\n'
  const session = { id: 's', taskId: 't', provider: 'codex' } as AgentSessionInfo
  const call = (name: string, args: Record<string, unknown>) => {
    const result = tools.get(name)!(args)
    return { error: !!result.isError, text: result.content[0]!.text }
  }
  beforeEach(() => {
    tools = new Map()
    const server = {
      registerTool: (name: string, _config: unknown, handler: Handler) => {
        tools.set(name, handler)
        return { remove() {} }
      },
    } as unknown as McpServer
    installedPath = join(root, 'installed', 'deploy-check', 'SKILL.md')
    mkdirSync(dirname(installedPath), { recursive: true })
    writeFileSync(installedPath, INSTALLED_TEXT)
    registerLibraryTools(
      server,
      {
        memory,
        learning,
        db,
        installedSkills: () => [{ name: 'deploy-check', description: 'Checks a deploy', path: installedPath }],
      },
      session,
    )
  })

  it('offers memory and skill tools and nothing else', () => {
    expect([...tools.keys()].sort()).toEqual([
      'memory_archive',
      'memory_merge',
      'memory_read',
      'memory_restore',
      'memory_search',
      'memory_update',
      'skill_archive',
      'skill_inspect',
      'skill_restore',
      'skill_update',
    ])
  })

  it('refuses to rewrite or archive memories you wrote or marked essential, and says who can', () => {
    const mine = memory.save(note('Mine'), { actor: 'user' }).memory
    const essential = memory.save({ ...note('Essential'), importance: 5 }, { actor: 'user' }).memory
    for (const id of [mine.id, essential.id]) {
      const update = call('memory_update', { id, content: 'AI rewrite', reason: 'cleanup' })
      expect(update.error).toBe(true)
      expect(update.text).toMatch(/protected.*edit it/i)
      const archive = call('memory_archive', { id, reason: 'redundant' })
      expect(archive.error).toBe(true)
      expect(archive.text).toMatch(/protected|only the user/i)
    }
    expect(memory.get(mine.id)).toMatchObject({ content: 'Mine body', status: 'active' })
    expect(memory.get(essential.id).status).toBe('active')
    expect(memory.history(mine.id)).toHaveLength(1)
  })

  it('edits an unprotected memory immediately and records a restorable revision', () => {
    const learned = memory.save(note('Learned', 'first wording'), agent).memory
    const updated = call('memory_update', { id: learned.id, content: 'better wording', reason: 'Clearer' })
    expect(updated.error).toBe(false)
    expect(memory.get(learned.id).content).toBe('better wording')
    const [revision] = memory.history(learned.id)
    expect(revision).toMatchObject({ action: 'update', reason: `Clearer${REVIEW_SUFFIX}` })
    expect(revision!.before?.content).toBe('first wording')
    // Restoring an earlier revision stays possible through the normal Memory page path.
    memory.revert(learned.id, 0, memory.get(learned.id).updatedAt)
    expect(memory.get(learned.id).content).toBe('first wording')
  })

  it('archives and restores through revisions, with the actor on each', () => {
    const learned = memory.save(note('Learned'), agent).memory
    expect(call('memory_archive', { id: learned.id, reason: 'Outdated' }).error).toBe(false)
    expect(memory.get(learned.id)).toMatchObject({ status: 'archived', archivedReason: `Outdated${REVIEW_SUFFIX}` })
    expect(call('memory_update', { id: learned.id, content: 'x', reason: 'r' }).text).toContain('archived')
    expect(call('memory_restore', { id: learned.id, reason: 'Mistake' }).error).toBe(false)
    expect(memory.get(learned.id).status).toBe('active')
    expect(memory.history(learned.id).map((entry) => [entry.action, entry.actor])).toEqual([
      ['restore', 'agent:codex'],
      ['archive', 'agent:codex'],
      ['add', 'agent:codex'],
    ])
  })

  it('merges overlapping notes into the first and archives the rest with a link, but never a protected one', () => {
    const a = memory.save(note('Tabs A', 'Use tabs'), agent).memory
    const b = memory.save(note('Tabs B', 'Tabs please'), agent).memory
    const mine = memory.save(note('Mine'), { actor: 'user' }).memory
    const refused = call('memory_merge', { ids: [a.id, mine.id], title: 'x', content: 'y', reason: 'dup' })
    expect(refused.error).toBe(true)
    expect(refused.text).toMatch(/protected/i)
    expect(memory.get(a.id).status).toBe('active')
    const merged = call('memory_merge', {
      ids: [a.id, b.id],
      title: 'Tabs',
      content: 'Use tabs.',
      reason: 'Same preference',
    })
    expect(merged.error).toBe(false)
    expect(memory.get(a.id)).toMatchObject({ title: 'Tabs', content: 'Use tabs.', status: 'active' })
    expect(memory.get(b.id)).toMatchObject({ status: 'archived' })
    expect(memory.get(b.id).archivedReason).toContain('Tabs')
    expect(memory.history(a.id)[0]).toMatchObject({ action: 'merge', reason: `Same preference${REVIEW_SUFFIX}` })
    expect(memory.history(b.id)[0]!.reason).toBe(`merged into ${a.id}`)
    expect(call('memory_restore', { id: b.id, reason: 'undo' }).error).toBe(false)
    expect(memory.get(b.id).status).toBe('active')
  })

  it('reads memories of any project, not only one', () => {
    db.exec("INSERT INTO projects(id,name,created_at) VALUES ('p','P',1)")
    const projectNote = memory.save({ ...note('Project note'), projectId: 'p' }, agent).memory
    expect(call('memory_read', { id: projectNote.id }).text).toContain('Project note')
    expect(call('memory_search', { query: 'project' }).text).toContain(projectNote.id)
    expect(call('memory_update', { id: projectNote.id, title: 'Renamed', reason: 'r' }).error).toBe(false)
  })

  it('changes only Ramu-generated, unpinned skills, each edit a new revision', () => {
    learning.write(skillOf('sk1'))
    const updated = call('skill_update', {
      id: 'sk1',
      content: 'Do sk1 better.',
      reason: 'More precise',
      expectedRevision: 1,
    })
    expect(updated.error).toBe(false)
    expect(learning.skills()[0]).toMatchObject({
      content: 'Do sk1 better.',
      revision: 2,
      changedBy: 'review',
      changeNote: `More precise${REVIEW_SUFFIX}`,
    })
    expect(learning.history('sk1').map((entry) => entry.revision)).toEqual([2, 1])
    expect(call('skill_update', { id: 'sk1', content: 'stale', reason: 'r', expectedRevision: 1 }).text).toMatch(
      /changed/,
    )
    expect(call('skill_archive', { id: 'sk1', reason: 'Redundant' }).error).toBe(false)
    expect(learning.skills()[0]).toMatchObject({ status: 'archived', revision: 3 })
    expect(call('skill_update', { id: 'sk1', content: 'x', reason: 'r' }).text).toContain('archived')
    expect(call('skill_restore', { id: 'sk1', reason: 'Mistake' }).error).toBe(false)
    expect(learning.skills()[0]).toMatchObject({ status: 'active', revision: 4 })
    // Revisions restore through the normal path.
    learning.revert('sk1', 1)
    expect(learning.skills()[0]).toMatchObject({ content: 'Do sk1 carefully.', revision: 5 })
  })

  it('refuses pinned skills and anything that is not a managed skill', () => {
    learning.write(skillOf('sk1'))
    learning.control('sk1', 'pin')
    expect(call('skill_update', { id: 'sk1', content: 'x', reason: 'r' }).text).toMatch(/pinned/)
    expect(call('skill_archive', { id: 'sk1', reason: 'r' }).error).toBe(true)
    const installed = call('skill_update', { id: 'installed-plugin-skill', content: 'x', reason: 'r' })
    expect(installed.error).toBe(true)
    expect(installed.text).toMatch(/Unknown skill/)
    expect(learning.skills()[0]!.pinned).toBe(true)
  })

  it('rejects credentials and duplicate names in skills', () => {
    learning.write(skillOf('sk1'))
    learning.write(skillOf('sk2'))
    expect(call('skill_update', { id: 'sk1', content: 'password: hunter2hunter2', reason: 'r' }).text).toMatch(
      /credential/,
    )
    expect(call('skill_update', { id: 'sk1', name: 'skill-sk2', reason: 'r' }).text).toMatch(/already exists/)
  })

  describe("protected items changed at the user's request", () => {
    const consent = { userRequested: true, userRequest: 'Please reword my tabs note to say spaces' }

    it("refuses without the flag, and refuses the flag without the user's words", () => {
      const mine = memory.save(note('Mine', 'Use tabs'), { actor: 'user' }).memory
      const refused = call('memory_update', { id: mine.id, content: 'Use spaces', reason: 'r' })
      expect(refused.error).toBe(true)
      expect(refused.text).toMatch(/protected.*userRequested/s)
      const unquoted = call('memory_update', { id: mine.id, content: 'Use spaces', reason: 'r', userRequested: true })
      expect(unquoted.error).toBe(true)
      expect(unquoted.text).toMatch(/Quote the user/)
      expect(memory.get(mine.id).content).toBe('Use tabs')
    })

    it('edits a protected memory when asked, keeps its protection, records a revision, and restores', () => {
      const mine = memory.save({ ...note('Mine', 'Use tabs'), importance: 5 }, { actor: 'user' }).memory
      const updated = call('memory_update', { id: mine.id, content: 'Use spaces', reason: 'User asked', ...consent })
      expect(updated.error).toBe(false)
      expect(JSON.parse(updated.text)).toMatchObject({ protectedChange: true, userRequest: consent.userRequest })
      const after = memory.get(mine.id)
      expect(after).toMatchObject({ content: 'Use spaces', importance: 5 })
      expect(after.source.confirmed).toBe(true)
      const [revision] = memory.history(mine.id)
      expect(revision).toMatchObject({ action: 'update', actor: 'agent:codex' })
      expect(revision!.reason).toContain('at your request')
      expect(revision!.before?.content).toBe('Use tabs')
      memory.revert(mine.id, 0, after.updatedAt)
      expect(memory.get(mine.id).content).toBe('Use tabs')
    })

    it('archives and merges protected memories only when asked', () => {
      const mine = memory.save(note('Mine', 'Use tabs'), { actor: 'user' }).memory
      const other = memory.save(note('Tabs again', 'Tabs'), agent).memory
      expect(call('memory_archive', { id: mine.id, reason: 'r' }).error).toBe(true)
      expect(call('memory_merge', { ids: [mine.id, other.id], title: 'T', content: 'C', reason: 'r' }).error).toBe(true)
      const merged = call('memory_merge', {
        ids: [mine.id, other.id],
        title: 'Tabs',
        content: 'Use tabs.',
        reason: 'dup',
        ...consent,
      })
      expect(merged.error).toBe(false)
      expect(memory.get(mine.id).source.confirmed).toBe(true)
      expect(memory.get(other.id).status).toBe('archived')
      const archived = call('memory_archive', { id: mine.id, reason: 'Outdated', ...consent })
      expect(JSON.parse(archived.text)).toMatchObject({ status: 'archived', protectedChange: true })
      expect(call('memory_restore', { id: mine.id, reason: 'undo' }).error).toBe(false)
      expect(memory.get(mine.id).status).toBe('active')
    })

    it('changes a pinned skill only when asked, as a restorable revision that stays pinned', () => {
      learning.write(skillOf('sk1'))
      learning.control('sk1', 'pin')
      expect(call('skill_update', { id: 'sk1', content: 'New', reason: 'r' }).error).toBe(true)
      const updated = call('skill_update', {
        id: 'sk1',
        content: 'New',
        activation: { requires_tools: ['browser_open'] },
        reason: 'r',
        ...consent,
      })
      expect(JSON.parse(updated.text)).toMatchObject({ protectedChange: true, pinned: true })
      expect(learning.skills()[0]).toMatchObject({ content: 'New', pinned: true, revision: 3 })
      expect(JSON.parse(call('skill_inspect', { id: 'sk1' }).text).activation).toEqual({
        requires_tools: ['browser_open'],
      })
      const cleared = call('skill_update', { id: 'sk1', activation: null, reason: 'Clear requirements', ...consent })
      expect(cleared.error).toBe(false)
      expect(learning.skills()[0]!.activation).toBeUndefined()
      learning.revert('sk1', 2)
      expect(learning.skills()[0]!.content).toBe('Do sk1 carefully.')
    })

    it('changes an installed skill only when asked, keeps the original as a revision, and restores it', () => {
      const id = 'installed:deploy-check'
      expect(JSON.parse(call('skill_inspect', {}).text).some((skill: { id: string }) => skill.id === id)).toBe(true)
      const refused = call('skill_update', { id, content: 'Changed', reason: 'r' })
      expect(refused.error).toBe(true)
      expect(refused.text).toMatch(/installed skill.*protected/)
      expect(call('skill_archive', { id, reason: 'r', ...consent }).error).toBe(true)
      expect(readFileSync(installedPath, 'utf8')).toBe(INSTALLED_TEXT)
      const updated = JSON.parse(call('skill_update', { id, content: 'Changed', reason: 'r', ...consent }).text)
      expect(updated).toMatchObject({ protectedChange: true, installed: true })
      expect(readFileSync(installedPath, 'utf8')).toBe('Changed\n')
      const read = JSON.parse(call('skill_inspect', { id }).text)
      expect(read.revisions.map((entry: { id: number }) => entry.id)).toEqual([updated.backupRevision])
      expect(call('skill_restore', { id, reason: 'undo', revision: updated.backupRevision }).error).toBe(true)
      const restored = call('skill_restore', { id, reason: 'undo', revision: updated.backupRevision, ...consent })
      expect(restored.error).toBe(false)
      expect(readFileSync(installedPath, 'utf8')).toBe(INSTALLED_TEXT)
      // The restore is itself undoable.
      expect(JSON.parse(call('skill_inspect', { id }).text).revisions).toHaveLength(2)
    })
  })

  it('does not register tools through the filtered server', () => {
    const register = vi.fn()
    const filtered = withoutTools({ registerTool: register, other: 1 } as unknown as McpServer)
    filtered.registerTool('schedule_create', {} as never, (() => ({ content: [] })) as never)
    expect(register).not.toHaveBeenCalled()
    expect((filtered as unknown as { other: number }).other).toBe(1)
  })
})
