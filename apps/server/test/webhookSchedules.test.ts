import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { ScheduleService } from '../src/background/schedules'
import { WebhookReceiver, parseBody, signatureMatches } from '../src/background/webhookReceiver'
import { WebhookSetup } from '../src/background/webhookSetup'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type ScheduleInput } from '@ramu/shared/types'
import { SOURCE_DEFAULTS, WEBHOOK_PRESETS, type WebhookTrigger } from '@ramu/shared/webhooks'
import type { AgentService } from '../src/agent'

let db: Db, dir: string, ws: Workspace, service: ScheduleService, receiver: WebhookReceiver
let start: ReturnType<typeof vi.fn>
beforeEach(() => {
  db = openDb(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'ramu-webhooks-'))
  ws = new Workspace(db, join(dir, 'worktrees'))
  start = vi.fn(() => ({ id: 'session' }))
  const agents = {
    validateSettings: async () => {},
    activeWriter: () => null,
    startReviewed: start,
    isRecoveryPending: () => false,
    providerWait: () => null,
    autoResumeOf: () => true,
    getGoal: () => null,
    queued: () => [],
    get: () => ({ id: 'session', state: 'running' }),
  } as unknown as AgentService
  service = new ScheduleService(db, ws, agents, () => {})
  receiver = new WebhookReceiver(service)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const ciPreset = WEBHOOK_PRESETS.find((preset) => preset.id === 'github-ci-failed')!
const trigger = (overrides: Partial<WebhookTrigger> = {}): WebhookTrigger => ({
  kind: 'webhook',
  source: 'github',
  filters: ciPreset.filters,
  signature: SOURCE_DEFAULTS.github.signature,
  replayKey: SOURCE_DEFAULTS.github.replayKey,
  coalesceKey: ciPreset.coalesceKey,
  coalesceSeconds: 120,
  fields: ciPreset.fields,
  ...overrides,
})
const input = (rule: WebhookTrigger = trigger()): ScheduleInput => ({
  name: 'Fix CI',
  prompt: 'Fix the failing run.',
  projectId: NO_PROJECT,
  timezone: 'Asia/Jakarta',
  rule,
  missedPolicy: 'latest',
  settings: DEFAULT_AGENT_SETTINGS,
})
const failure = (sha = 'abc', delivery = `d-${Math.random()}`) => ({
  headers: { 'x-github-event': 'workflow_run', 'x-github-delivery': delivery, 'content-type': 'application/json' },
  body: Buffer.from(
    JSON.stringify({
      action: 'completed',
      repository: { full_name: 'ahxar/ramu' },
      workflow_run: {
        name: 'CI',
        conclusion: 'failure',
        head_sha: sha,
        head_branch: 'fix',
        html_url: 'https://github.com/ahxar/ramu/actions/runs/1',
        pull_requests: [{ number: 7 }],
      },
    }),
  ),
})
/** Signs and sends a request the way GitHub does, to the schedule's own address. */
function send(scheduleId: string, request = failure(), options: { sign?: boolean; now?: number } = {}) {
  const { path, secret } = service.webhook(scheduleId)
  const headers: Record<string, string> = { ...request.headers }
  if (options.sign !== false)
    headers['x-hub-signature-256'] = `sha256=${createHmac('sha256', secret!).update(request.body).digest('hex')}`
  return receiver.receive(path.slice('/hooks/'.length), headers, request.body, options)
}

describe('a webhook schedule', () => {
  it('waits for requests instead of a clock, and keeps its address out of the schedule list', async () => {
    const schedule = service.save(input())
    expect(schedule).toMatchObject({ state: 'active', nextRunAt: null, webhook: { hasSecret: true } })
    expect(JSON.stringify(service.list())).not.toContain(service.webhook(schedule.id).path.slice(7))
    await service.tick()
    expect(start).not.toHaveBeenCalled()
    service.pause(schedule.id, true)
    expect(service.pause(schedule.id, false).state).toBe('active')
  })

  it('offers its address on each route the host has, with the secret to paste into the sender', () => {
    service.webhookBases = () => [{ url: 'http://192.168.1.4:7788', via: 'en0' }]
    const schedule = service.save(input())
    const { urls, path, secret } = service.webhook(schedule.id)
    expect(urls).toEqual([{ url: `http://192.168.1.4:7788${path}`, via: 'en0' }])
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps its address and secret through an edit, and a new address ends the old one', () => {
    const schedule = service.save(input())
    const before = service.webhook(schedule.id)
    service.save({ ...input(), name: 'Renamed' }, schedule.id)
    expect(service.webhook(schedule.id)).toEqual(before)
    service.rotateWebhook(schedule.id)
    expect(service.webhook(schedule.id).path).not.toBe(before.path)
    expect(receiver.receive(before.path.slice(7), {}, Buffer.from('{}'))).toMatchObject({ status: 404 })
  })
})

describe('receiving a request', () => {
  it('starts a run whose prompt holds the chosen fields fenced as untrusted data', async () => {
    const schedule = service.save(input())
    const answer = send(schedule.id)
    expect(answer).toMatchObject({ status: 202, delivery: { outcome: 'started' } })
    // The delivery starts the run itself; nothing waits for the next tick.
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    const prompt = start.mock.calls[0]![2] as string
    expect(prompt.startsWith('Fix the failing run.')).toBe(true)
    expect(prompt).toContain('untrusted data')
    expect(prompt).toContain('"body.workflow_run.head_sha": "abc"')
    expect(ws.getTask(service.runs(schedule.id)[0]!.taskId!).title).toContain('workflow_run.completed')
  })

  it('logs and ignores a request with a wrong or missing signature', () => {
    const schedule = service.save(input())
    expect(send(schedule.id, failure(), { sign: false })).toMatchObject({ delivery: { outcome: 'bad-signature' } })
    expect(service.runs(schedule.id)).toHaveLength(0)
    expect(service.deliveries(schedule.id)[0]).toMatchObject({ outcome: 'bad-signature', runId: null })
  })

  it('says which filter a request missed', () => {
    const schedule = service.save(input())
    const success = failure()
    success.body = Buffer.from(success.body.toString().replace('"failure"', '"success"'))
    expect(send(schedule.id, success)).toMatchObject({
      delivery: { outcome: 'filtered', detail: 'body.workflow_run.conclusion equals failure did not match.' },
    })
  })

  it('ignores a delivery the sender retries, and folds a burst for one commit into one run', () => {
    const schedule = service.save(input())
    expect(send(schedule.id, failure('abc', 'same'))).toMatchObject({ delivery: { outcome: 'started' } })
    expect(send(schedule.id, failure('abc', 'same'))).toMatchObject({ delivery: { outcome: 'duplicate' } })
    expect(send(schedule.id, failure('abc'))).toMatchObject({ delivery: { outcome: 'coalesced' } })
    expect(send(schedule.id, failure('def'))).toMatchObject({ delivery: { outcome: 'started' } })
    expect(service.runs(schedule.id)).toHaveLength(2)
  })

  it('records but does not run a request for a paused schedule', () => {
    const schedule = service.save(input())
    service.pause(schedule.id, true)
    expect(send(schedule.id)).toMatchObject({ delivery: { outcome: 'paused' } })
    expect(service.runs(schedule.id).filter((run) => run.status === 'queued')).toHaveLength(0)
  })

  it('refuses a flood from one address', () => {
    const schedule = service.save(input(trigger({ replayKey: null, coalesceKey: null, filters: [] })))
    const now = Date.now()
    for (let i = 0; i < 30; i++) send(schedule.id, failure(), { now })
    expect(send(schedule.id, failure(), { now })).toMatchObject({ status: 429 })
  })

  it('replays a delivery that was filtered out, and sends a test that passes the filters', async () => {
    const schedule = service.save(input())
    const success = failure()
    success.body = Buffer.from(success.body.toString().replace('"failure"', '"success"'))
    const filtered = send(schedule.id, success)
    if (!('delivery' in filtered)) throw new Error('expected a delivery')
    expect(service.replay(schedule.id, filtered.delivery.id)).toMatchObject({ outcome: 'replayed' })
    expect(service.sendTest(schedule.id)).toMatchObject({ outcome: 'test' })
    expect(service.runs(schedule.id)).toHaveLength(2)
  })
})

describe('reading what senders send', () => {
  it('checks HMAC and token signatures against the exact bytes', () => {
    const raw = Buffer.from('{"a":1}')
    const hmac = { kind: 'hmac' as const, header: 'sentry-hook-signature', encoding: 'hex' as const, prefix: '' }
    const good = createHmac('sha256', 's3cret').update(raw).digest('hex')
    expect(signatureMatches(hmac, 's3cret', { 'sentry-hook-signature': good }, raw)).toBe(true)
    expect(signatureMatches(hmac, 's3cret', { 'sentry-hook-signature': good }, Buffer.from('{"a":2}'))).toBe(false)
    expect(signatureMatches(hmac, null, { 'sentry-hook-signature': good }, raw)).toBe(false)
    const token = { kind: 'token' as const, header: 'x-gitlab-token' }
    expect(signatureMatches(token, 'tok', { 'x-gitlab-token': 'tok' }, raw)).toBe(true)
    expect(signatureMatches(token, 'tok', {}, raw)).toBe(false)
    expect(signatureMatches(null, null, {}, raw)).toBe(true)
  })

  it('reads JSON, GitHub’s form posts and plain text', () => {
    expect(parseBody(Buffer.from('{"a":1}'), 'application/json')).toEqual({ a: 1 })
    expect(
      parseBody(Buffer.from(`payload=${encodeURIComponent('{"a":1}')}`), 'application/x-www-form-urlencoded'),
    ).toEqual({ a: 1 })
    expect(parseBody(Buffer.from('hello'), 'text/plain')).toBe('hello')
  })
})

describe('setting up a GitHub webhook for the person', () => {
  const project = () => {
    db.prepare("INSERT INTO projects (id, name, created_at) VALUES ('p1', 'Ramu', 0)").run()
    db.prepare("INSERT INTO repositories (id, project_id, name, root) VALUES ('r1', 'p1', 'ramu', '/code/ramu')").run()
    db.prepare("INSERT INTO repositories (id, project_id, name, root) VALUES ('r2', 'p1', 'docs', '/code/docs')").run()
  }
  const calls: { kind: string; root: string; config?: unknown }[] = []
  const github = {
    remoteOf: async (root: string) =>
      root === '/code/ramu' ? { origin: 'github.com', protocol: 'https' as const, owner: 'ahxar', repo: 'ramu' } : null,
    isGithub: async (origin: string) => origin === 'github.com',
    create: async (root: string, config: unknown) => {
      calls.push({ kind: 'create', root, config })
      return { origin: 'github.com', owner: 'ahxar', repo: 'ramu', id: 42 }
    },
    update: async (root: string, _hook: unknown, config: unknown) => void calls.push({ kind: 'update', root, config }),
    remove: async (root: string) => void calls.push({ kind: 'remove', root }),
  }
  beforeEach(() => void calls.splice(0))

  it('offers only the project’s GitHub repositories', async () => {
    project()
    const schedule = service.save({ ...input(), projectId: 'p1' })
    const setup = new WebhookSetup(service, ws, github)
    expect(await setup.githubRepos(schedule.id)).toEqual([{ repoId: 'r1', name: 'ramu', slug: 'ahxar/ramu' }])
  })

  it('needs an address GitHub can reach', async () => {
    project()
    service.webhookBases = () => [{ url: 'http://192.168.1.4:7788', via: 'en0' }]
    const schedule = service.save({ ...input(), projectId: 'p1' })
    await expect(new WebhookSetup(service, ws, github).connectGithub(schedule.id, 'r1')).rejects.toThrow(
      'Tunnel address',
    )
  })

  it('creates the webhook with the HTTPS address, secret and the events its filters name, and keeps it current', async () => {
    project()
    service.webhookBases = () => [
      { url: 'http://192.168.1.4:7788', via: 'en0' },
      { url: 'https://studio.example.ts.net', via: 'tailscale0' },
    ]
    const schedule = service.save({ ...input(), projectId: 'p1' })
    const setup = new WebhookSetup(service, ws, github)
    const connected = await setup.connectGithub(schedule.id, 'r1')
    const { path, secret } = service.webhook(schedule.id)
    expect(connected.webhook).toMatchObject({ github: 'ahxar/ramu' })
    expect(calls[0]).toEqual({
      kind: 'create',
      root: '/code/ramu',
      config: { url: `https://studio.example.ts.net${path}`, secret, events: ['workflow_run'] },
    })
    service.rotateWebhook(schedule.id)
    await setup.refresh(schedule.id)
    expect(calls.at(-1)).toMatchObject({ kind: 'update', config: { secret: service.webhook(schedule.id).secret } })
    await setup.beforeDelete(schedule.id)
    expect(calls.at(-1)).toEqual({ kind: 'remove', root: '/code/ramu' })
  })
})
