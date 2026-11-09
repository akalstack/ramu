import { afterEach, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { InteractiveStore, type InteractiveInput } from '../src/interactive/store'
import { PageStore, parseCsv, stripJpegMetadata } from '../src/interactive/pages'
import { PageAi, answerProblem, type Analyze } from '../src/interactive/pageAi'
import { PageAutomation, scheduleSlot, triggerMatches } from '../src/interactive/pageAutomation'
import { pageCapabilitiesOf } from '../src/interactive/capabilities'
import { interactiveBrowserPath } from '../src/interactive/preview'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'

const databases: Db[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const ledger = {
  records: { transactions: { fields: { date: 'date', amount: 'number', category: 'string', note: 'string?' } } },
  ai: { purpose: 'Reads what you type into a transaction' },
  notify: { purpose: 'Large spending' },
  runs: { review: { label: 'Review', prompt: 'Summarize spending' } },
  schedules: [{ run: 'review', every: 'daily', at: '08:00' }],
  triggers: [{ collection: 'transactions', when: { field: 'amount', op: '>', value: 100 }, notify: 'Big one' }],
}
const html = (capabilities: unknown) =>
  `<meta name="ramu-capabilities" content='${JSON.stringify(capabilities)}'><p>Ledger</p>`
const input: InteractiveInput = { title: 'Ledger', summary: 'Spending', html: html(ledger), checks: [] }
const previewer = async () => ({
  screenshot: 'data:image/png;base64,AA==',
  wideScreenshot: 'data:image/png;base64,AQ==',
  height: 400,
  checks: [],
  errors: [] as string[],
})

async function setup() {
  const db = openDb(':memory:')
  databases.push(db)
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','P',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','T','current','idle',0); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES('s','t','codex','/tmp','idle',0),('other','t','codex','/tmp','idle',0)",
  )
  const record = vi.fn()
  const interactive = new InteractiveStore(db, record, previewer)
  const changed = vi.fn()
  const pages = new PageStore(db, interactive, changed)
  const v1 = interactive.publish('s', (await interactive.preview('s', input)).id, 'r1')
  const page = pages.keep('s', v1.id, { title: 'My ledger', icon: '💸' })
  return { db, interactive, pages, page, record, changed }
}

it('keeps a thread document as a page and takes versions from any thread', async () => {
  const { interactive, pages, page } = await setup()
  expect(page).toMatchObject({
    title: 'My ledger',
    icon: '💸',
    version: 1,
    pendingGrants: ['records', 'ai', 'notify', 'schedules', 'triggers'],
  })
  expect(pages.list().map((entry) => entry.id)).toEqual([page.id])
  // Another thread publishes the next version through the page.
  const preview = await interactive.preview('other', { ...input, html: input.html + '<p>Two</p>' })
  interactive.publish('other', preview.id, 'r2', {
    previous: { id: page.id, version: 1 },
    changes: 'Adds a second line',
    acrossSessions: true,
    artifactId: page.id,
    onPublished: (published) => pages.addVersion(page.id, published),
  })
  expect(pages.get(page.id)).toMatchObject({ version: 2, sessionId: 'other' })
  expect(pages.document(page.id).html).toContain('Two')
  expect(pages.versions(page.id).map((entry) => entry.reference.version)).toEqual([2, 1])
  const restored = pages.restoreVersion(page.id, 1)
  expect(restored.version).toBe(3)
  expect(pages.document(page.id).reference).toMatchObject({ restoredFrom: 1, changes: 'Restored v1' })
  const copy = pages.duplicate(page.id)
  expect(copy).toMatchObject({ version: 1, duplicatedFrom: page.id, grants: {} })
  pages.delete(page.id)
  expect(pages.has(page.id)).toBe(false)
})

it('lists artifacts as Apps through IPC and to agents through the artifact tools', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { ToolRegistry } = await import('../src/agent/toolRegistry')
  const { registerInteractiveTools } = await import('../src/interactive/tools')
  const { interactive, pages, page } = await setup()
  const methods = registerArtifactHandlers({ pages, pageAi: {}, activity: { run: () => {} } } as never)
  expect(Object.keys(methods).every((name) => name.startsWith('artifacts.'))).toBe(true)
  expect(methods['artifacts.list']!.run()).toMatchObject([{ id: page.id, kind: 'app' }])
  const registry = new ToolRegistry(new McpServer({ name: 'test', version: '1' }), true)
  registerInteractiveTools(registry.server, interactive, 's', { pages, ai: {} as never, projectId: () => null })
  const extra = { signal: new AbortController().signal } as Parameters<typeof registry.invoke>[2]
  const result = await registry.invoke('artifact_list', {}, extra)
  expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject([
    { id: page.id, kind: 'app', title: 'My ledger' },
  ])
  expect((await registry.invoke('page_list', {}, extra)).isError).toBe(true)
  expect(registry.search('artifact', 30).map((tool) => tool.name)).toEqual(
    expect.arrayContaining(['artifact_list', 'artifact_get', 'artifact_records', 'artifact_run']),
  )
})

it('shares state across devices without blind overwrites', async () => {
  const { pages, page } = await setup()
  const state = { controls: [{ key: '0:amount', value: '35', checked: false }], custom: null }
  expect(pages.saveState(page.id, state, 0)).toMatchObject({ accepted: true, revision: 1 })
  // A device that read revision 0 gets the newer state back instead of overwriting it.
  const stale = pages.saveState(page.id, { ...state, custom: 'phone' }, 0)
  expect(stale).toMatchObject({ accepted: false, revision: 1, state })
})

it('keeps records only when granted, checks them against the schema and exports them', async () => {
  const { pages, page } = await setup()
  expect(() => pages.addRecord(page.id, 'transactions', { date: '2026-11-06', amount: 1, category: 'x' })).toThrow(
    'not allowed',
  )
  pages.grant(page.id, { records: true })
  expect(() => pages.addRecord(page.id, 'transactions', { date: 'soon', amount: 1, category: 'x' })).toThrow('date')
  expect(() =>
    pages.addRecord(page.id, 'transactions', { date: '2026-11-06', amount: 1, category: 'x', extra: 1 }),
  ).toThrow('not a field')
  pages.addRecord(page.id, 'transactions', { date: '2026-11-05', amount: 35, category: 'food', note: 'coffee, "big"' })
  pages.addRecord(page.id, 'transactions', { date: '2026-11-06', amount: 15, category: 'food' })
  pages.addRecord(page.id, 'transactions', { date: '2026-10-01', amount: 100, category: 'rent' })
  expect(pages.sum(page.id, 'transactions', 'amount', 'category')).toEqual({ food: 50, rent: 100 })
  expect(
    pages
      .records(page.id, 'transactions', { range: { field: 'date', from: '2026-11-01' }, sort: { field: 'amount' } })
      .map((record) => record.data.amount),
  ).toEqual([15, 35])
  const exported = pages.exportRecords(page.id)
  expect(exported.csv.transactions).toContain('"coffee, ""big"""')
  expect(pages.importCsv(page.id, 'transactions', 'date,amount,category\n2026-11-07,9,tea\n')).toEqual({ added: 1 })
  expect(() => pages.importCsv(page.id, 'transactions', 'date,amount,category\nbad,9,tea\n')).toThrow('Row 2')
})

it('moves records to a new schema with migrate rules and refuses ones that do not fit', async () => {
  const { pages, page } = await setup()
  pages.grant(page.id, { records: true })
  pages.addRecord(page.id, 'transactions', { date: '2026-11-05', amount: 35, category: 'food' })
  const renamed = {
    records: { transactions: { fields: { date: 'date', amount: 'number', kind: 'string', currency: 'string' } } },
  } as const
  expect(pages.migrate(page.id, renamed, true).problems).toHaveLength(1)
  const withRules = {
    records: {
      transactions: {
        fields: renamed.records.transactions.fields,
        migrate: { kind: { from: 'category' }, currency: { default: 'IDR' } },
      },
    },
  }
  expect(pages.migrate(page.id, withRules, false)).toEqual({ moved: 1, problems: [] })
  expect(pages.migrate(page.id, renamed, true).problems).toEqual([])
})

it('answers Ask with JSON that fits the shape, retrying once, within the daily budget', async () => {
  const { pages, page } = await setup()
  const replies = ['not json', '{"amount":35000,"category":"food","date":"2026-11-05"}']
  const analyze = vi.fn<Analyze>(async () => ({ message: replies.shift()!, provider: 'codex', model: 'm' }))
  const ai = new PageAi(pages, analyze, () => DEFAULT_AGENT_SETTINGS)
  await expect(ai.ask(page.id, 'coffee 35k yesterday')).rejects.toThrow('not allowed')
  pages.grant(page.id, { ai: { model: 'fast', daily: 2 } })
  const answer = await ai.ask(page.id, 'coffee 35k yesterday', {
    shape: { amount: 'number', category: 'string', date: 'date' },
  })
  expect(answer).toEqual({ amount: 35000, category: 'food', date: '2026-11-05' })
  expect(analyze).toHaveBeenCalledTimes(2)
  expect(analyze.mock.calls[0]![0]).toContain('<page-request>\ncoffee 35k yesterday')
  analyze.mockResolvedValue({ message: 'ok', provider: 'codex', model: 'm' })
  await ai.ask(page.id, 'again')
  await expect(ai.ask(page.id, 'third')).rejects.toThrow('reached its 2 model requests')
})

it('runs a page agent with record tools, waits for the person before deleting, and undoes its changes together', async () => {
  const { pages, page } = await setup()
  pages.grant(page.id, { records: true, ai: { model: 'smart', daily: 50 } })
  const kept = pages.addRecord(page.id, 'transactions', { date: '2026-11-01', amount: 5, category: 'misc' })
  const steps = [
    {
      say: 'Adding coffee',
      tool: 'records_add',
      input: { collection: 'transactions', data: { date: '2026-11-05', amount: 35, category: 'food' } },
    },
    {
      say: 'Fixing the category',
      tool: 'records_update',
      input: { collection: 'transactions', id: kept.id, patch: { category: 'fees' } },
    },
    { say: 'Removing the old one', tool: 'records_delete', input: { collection: 'transactions', ids: [kept.id] } },
    { say: 'Done', answer: 'Added one, recategorized one.' },
  ]
  const ai = new PageAi(
    pages,
    async () => ({ message: JSON.stringify(steps.shift()), provider: 'codex', model: 'm' }),
    () => DEFAULT_AGENT_SETTINGS,
  )
  const confirmed = vi.fn()
  const changed = vi.spyOn(pages, 'saveRun').mockImplementation(function (this: PageStore, run) {
    if (run.confirm) {
      confirmed(run.confirm.text)
      queueMicrotask(() => ai.answer(run.confirm!.id, false))
    }
    return PageStore.prototype.saveRun.call(this, run)
  })
  const run = await ai.run(page.id, 'Tidy my spending', { source: 'artifact' })
  changed.mockRestore()
  expect(run).toMatchObject({ status: 'done', answer: 'Added one, recategorized one.', changes: 2 })
  expect(run.steps.map((step) => step.text)).toEqual([
    'Adding coffee',
    'Fixing the category',
    'Removing the old one',
    'Done',
  ])
  expect(confirmed).toHaveBeenCalledWith('Delete 1 transactions record?')
  expect(pages.records(page.id, 'transactions')).toHaveLength(2)
  pages.undoRun(run.id)
  const after = pages.records(page.id, 'transactions')
  expect(after.map((record) => record.data.category)).toEqual(['misc'])
  expect(pages.runs(page.id)[0]).toMatchObject({ status: 'undone' })
})

it('fires triggers on records, accepts webhook records and runs schedules once per slot', async () => {
  const { pages, page } = await setup()
  pages.grant(page.id, {
    records: true,
    notify: true,
    triggers: true,
    ai: { model: 'fast', daily: 5 },
    schedules: true,
  })
  const notify = vi.fn()
  const run = vi.fn(async () => ({}) as never)
  const marks: Record<string, number> = {}
  const automation = new PageAutomation(pages, { run } as unknown as PageAi, notify, {
    read: () => ({ ...marks }),
    write: (next) => Object.assign(marks, next),
  })
  pages.onRecord = (artifactId, record) => automation.recordChanged(artifactId, record)
  pages.addRecord(page.id, 'transactions', { date: '2026-11-05', amount: 500, category: 'rent' })
  pages.addRecord(page.id, 'transactions', { date: '2026-11-05', amount: 5, category: 'food' })
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify.mock.calls[0]![2]).toBe('Big one')
  expect(automation.receive('x'.repeat(30), Buffer.from('{}')).status).toBe(404)
  const granted = pages.grant(page.id, { webhook: { token: '' } })
  expect(granted.grants.webhook).toBeFalsy() // the page did not declare a webhook
  const morning = new Date(2026, 10, 6, 9, 0)
  await automation.tick(morning)
  await automation.tick(new Date(2026, 10, 6, 10, 0))
  expect(run).toHaveBeenCalledTimes(1)
  await automation.tick(new Date(2026, 10, 7, 8, 1))
  expect(run).toHaveBeenCalledTimes(2)
  expect(scheduleSlot({ run: 'x', every: 'daily', at: '08:00' }, new Date(2026, 10, 6, 7, 0))).toBeNull()
  expect(
    triggerMatches(
      { collection: 'c', when: { field: 'n', op: '>=', value: 3 } },
      {
        id: '1',
        collection: 'c',
        data: { n: 3 },
        createdAt: 0,
        updatedAt: 0,
      },
    ),
  ).toBe(true)
})

it('validates declared capabilities before preview', () => {
  expect(pageCapabilitiesOf({ html: '<p>none</p>' })).toEqual({})
  expect(() => pageCapabilitiesOf({ html: html({ runs: { a: { label: 'A', prompt: 'Do it' } } }) })).toThrow(
    'declare ai',
  )
  expect(() =>
    pageCapabilitiesOf({ html: html({ widget: { title: 'x', collection: 'nope', kind: 'number' } }) }),
  ).toThrow('Unknown collection')
  expect(() => pageCapabilitiesOf({ files: [{ path: 'ramu.json', content: '{bad' }] })).toThrow('not valid JSON')
  expect(answerProblem([{ n: 'number' }], [{ n: 1 }, { n: 'x' }])).toBe('item 2: n must be a number')
})

it('shares a page through expiring, revocable links', async () => {
  const { pages, page } = await setup()
  const share = pages.share(page.id, true)
  expect(pages.resolveShare(share.token)).toMatchObject({ artifactId: page.id, canAdd: true })
  expect(pages.shares(page.id)).toHaveLength(1)
  pages.revokeShare(share.token)
  expect(() => pages.resolveShare(share.token)).toThrow('expired or was revoked')
})

it('parses CSV and strips photo location metadata', () => {
  expect(parseCsv('a,b\n"x, y","z""q"\r\n')).toEqual([
    ['a', 'b'],
    ['x, y', 'z"q'],
  ])
  const exif = Buffer.from([0xff, 0xe1, 0x00, 0x04, 0x01, 0x02])
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), exif, Buffer.from([0xff, 0xda, 0x00, 0x02, 0x09])])
  expect(stripJpegMetadata(jpeg, 'image/jpeg')).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x09]))
})

it('reads only the granted project folder, read-only', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const root = mkdtempSync(join(tmpdir(), 'ramu-page-folder-'))
  mkdirSync(join(root, 'data'))
  writeFileSync(join(root, 'data', 'a.json'), '{"ok":true}')
  writeFileSync(join(root, 'secret.txt'), 'no')
  const db = openDb(':memory:')
  databases.push(db)
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','P',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','T','current','idle',0); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES('s','t','codex','/tmp','idle',0)",
  )
  const interactive = new InteractiveStore(db, () => {}, previewer)
  const pages = new PageStore(db, interactive)
  const v1 = interactive.publish(
    's',
    (await interactive.preview('s', { ...input, html: html({ folder: { path: 'data' } }) })).id,
    'r',
  )
  const page = pages.keep('s', v1.id, { projectId: 'p' })
  const methods = registerArtifactHandlers({
    pages,
    pageAi: new PageAi(
      pages,
      async () => ({ message: '', provider: 'codex', model: 'm' }),
      () => DEFAULT_AGENT_SETTINGS,
    ),
    workspace: { listProjects: () => [{ id: 'p', root }] },
    activity: { run: (_l: string, _d: string, work: () => unknown) => work() },
  } as never)
  const call = (method: string, args: unknown[]) =>
    methods['artifacts.call']!.run(page.id, method, args) as Promise<unknown>
  await expect(call('folder.list', [])).rejects.toThrow('not allowed')
  pages.grant(page.id, { folder: true })
  expect(await call('folder.list', [])).toEqual([{ name: 'a.json', folder: false }])
  expect(await call('folder.read', ['a.json'])).toBe('{"ok":true}')
  await expect(call('folder.read', ['../secret.txt'])).rejects.toThrow('Only the granted folder')
})

it('gives page runs web search and only the Shared MCP servers granted, each call confirmed', async () => {
  const { parseSearchResults } = await import('../src/interactive/pageAi')
  expect(
    parseSearchResults(
      '<div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Frate&amp;rut=x">USD &amp; IDR</a><a class="result__snippet">1 USD = 16,000 IDR</a></div>',
    ),
  ).toEqual([{ title: 'USD & IDR', url: 'https://example.com/rate', snippet: '1 USD = 16,000 IDR' }])
  const { pages, page } = await setup()
  const capabilities = { ai: { purpose: 'Converts money', web: true, mcp: ['mail', 'bank'] } }
  const db = (pages as unknown as { db: Db }).db
  db.prepare('UPDATE artifacts SET data=json_set(data, ?, json(?)) WHERE id=?').run(
    '$.capabilities',
    JSON.stringify(capabilities),
    page.id,
  )
  pages.grant(page.id, { ai: { model: 'fast', daily: 20, web: true, mcp: ['mail'] } })
  const opened = vi.fn()
  const mailCall = vi.fn(async () => [{ type: 'text', text: 'statement found' }])
  const external = {
    search: vi.fn(async () => [{ title: 'rate', url: 'https://example.com', snippet: '16000' }]),
    open: vi.fn(async (_page: unknown, _settings: unknown, servers: string[]) => {
      opened(servers)
      return {
        tools: [
          { name: 'find', server: 'mail', description: 'Find mail', inputSchema: {}, readOnly: false, call: mailCall },
        ],
        close: async () => {},
      }
    }),
  }
  const steps = [
    { tool: 'web_search', input: { query: 'usd idr' } },
    { tool: 'mcp_0', input: { q: 'bank statement' } },
    { answer: 'done' },
  ]
  const ai = new PageAi(
    pages,
    async (prompt) => {
      if (steps.length === 3) expect(prompt).toContain('web_search')
      return { message: JSON.stringify(steps.shift()), provider: 'codex', model: 'm' }
    },
    () => DEFAULT_AGENT_SETTINGS,
    external as never,
  )
  const save = vi.spyOn(pages, 'saveRun').mockImplementation(function (this: PageStore, run) {
    if (run.confirm) queueMicrotask(() => ai.answer(run.confirm!.id, true))
    return PageStore.prototype.saveRun.call(this, run)
  })
  const run = await ai.run(page.id, 'Find my rate', { source: 'artifact' })
  save.mockRestore()
  expect(run.status).toBe('done')
  expect(opened).toHaveBeenCalledWith(['mail'])
  expect(external.search).toHaveBeenCalledWith('usd idr', expect.anything())
  expect(mailCall).toHaveBeenCalledWith({ q: 'bank statement' }, expect.anything())
})

it('runs a server’s read-only tools without asking once allowed, and still asks for anything else', async () => {
  const { pages, page } = await setup()
  const db = (pages as unknown as { db: Db }).db
  db.prepare('UPDATE artifacts SET data=json_set(data, ?, json(?)) WHERE id=?').run(
    '$.capabilities',
    JSON.stringify({ ai: { purpose: 'Bank summary', mcp: ['bank'] } }),
    page.id,
  )
  pages.grant(page.id, { ai: { model: 'fast', daily: 20, mcp: ['bank'], mcpReads: ['bank'] } })
  const read = vi.fn(async () => [{ type: 'text', text: 'balance 10' }])
  const pay = vi.fn(async () => [{ type: 'text', text: 'paid' }])
  const external = {
    search: vi.fn(),
    open: vi.fn(async () => ({
      tools: [
        { name: 'balance', server: 'bank', description: 'Balance', inputSchema: {}, readOnly: true, call: read },
        { name: 'pay', server: 'bank', description: 'Pay', inputSchema: {}, readOnly: false, call: pay },
      ],
      close: async () => {},
    })),
  }
  const steps = [{ tool: 'mcp_0', input: {} }, { tool: 'mcp_1', input: { to: 'x' } }, { answer: 'done' }]
  const prompts: string[] = []
  const ai = new PageAi(
    pages,
    async (prompt) => {
      prompts.push(prompt)
      return { message: JSON.stringify(steps.shift()), provider: 'codex', model: 'm' }
    },
    () => DEFAULT_AGENT_SETTINGS,
    external as never,
  )
  const asked: string[] = []
  const save = vi.spyOn(pages, 'saveRun').mockImplementation(function (this: PageStore, run) {
    if (run.confirm && !asked.includes(run.confirm.id)) {
      asked.push(run.confirm.id)
      queueMicrotask(() => ai.answer(run.confirm!.id, false))
    }
    return PageStore.prototype.saveRun.call(this, run)
  })
  const run = await ai.run(page.id, 'Pay rent', { source: 'artifact' })
  save.mockRestore()
  expect(run.status).toBe('done')
  expect(prompts[0]).toContain('reads; runs without asking')
  expect(read).toHaveBeenCalled()
  expect(asked).toHaveLength(1)
  expect(pay).not.toHaveBeenCalled()
})

it.skipIf(!interactiveBrowserPath())(
  'loads a page on the host so a scheduled run can call the functions it registers',
  async () => {
    const { openHeadlessPage } = await import('../src/interactive/pageHeadless')
    const { pages, interactive } = await setup()
    const source = `${html({ records: ledger.records, ai: ledger.ai })}<script>ramuContent.ai.tool('convert', {description: 'IDR to USD', input: {idr: 'number'}}, async ({idr}) => { const list = await ramuContent.records.list('transactions'); return {usd: idr / 16000, records: list.length} })</script>`
    const v = interactive.publish('s', (await interactive.preview('s', { ...input, html: source })).id, 'h1')
    const page = pages.keep('s', v.id)
    pages.grant(page.id, { records: true })
    pages.addRecord(page.id, 'transactions', { date: '2026-11-05', amount: 1, category: 'x' })
    const frame = await openHeadlessPage(pages.get(page.id), pages)
    try {
      expect(frame.functions.map((fn) => fn.name)).toEqual(['convert'])
      expect(await frame.call('convert', { idr: 32000 })).toEqual({ usd: 2, records: 1 })
      // Edit's selector for the script's sibling paragraph; a screenshot of an element is a PNG.
      expect((await frame.screenshot('p'))?.subarray(1, 4).toString()).toBe('PNG')
      expect(await frame.screenshot('p > script; alert(1)')).toBeNull()
    } finally {
      await frame.close()
    }
  },
  30_000,
)

it('runs kept checks once when the shipped libraries change, and reports a page they would break', async () => {
  const { interactive, pages } = await setup()
  const project = {
    ...input,
    html: undefined,
    files: [
      { path: 'index.html', content: '<div id="root"></div><script type="module" src="./main.js"></script>' },
      { path: 'main.js', content: 'document.body.append("x")' },
    ],
  }
  const v = interactive.publish('s', (await interactive.preview('s', project)).id, 'lib1')
  const page = pages.keep('s', v.id)
  const check = vi.fn(async () => ({ passed: false, detail: 'Check failed: Total' }))
  const seen: Record<string, string> = {}
  const automation = new PageAutomation(
    pages,
    {} as PageAi,
    () => {},
    { read: () => ({}), write: () => {} },
    undefined,
    {
      pinned: () => ({ react: '99.0.0' }),
      check,
      seen: { read: () => ({ ...seen }), write: (next) => Object.assign(seen, next) },
    },
  )
  await automation.checkLibraries()
  await automation.checkLibraries()
  expect(check).toHaveBeenCalledTimes(1)
  expect(pages.get(page.id).lastError?.message).toContain('would break: Check failed: Total')
})

it('imports a page another host shared without its records, values or grants', async () => {
  const { pages, page } = await setup()
  pages.grant(page.id, { records: true })
  pages.addRecord(page.id, 'transactions', { date: '2026-11-05', amount: 1, category: 'x' })
  const document = pages.document(page.id)
  const copy = pages.importPage(document, { title: 'Ledger from home', icon: '💸' })
  expect(copy).toMatchObject({ title: 'Ledger from home', version: 1, grants: {}, projectId: null })
  expect(copy.pendingGrants).toContain('records')
  expect(pages.document(copy.id).html).toBe(document.html)
  pages.grant(copy.id, { records: true })
  expect(pages.records(copy.id, 'transactions')).toEqual([])
  expect(() =>
    pages.importPage(
      { ...document, reference: { ...document.reference, network: { resources: ['http://10.0.0.1'], connect: [] } } },
      { title: 'x', icon: 'x' },
    ),
  ).toThrow('HTTPS origin')
})

it('publishes a page without records or AI to the web and updates the same site later', async () => {
  const { PagePublisher } = await import('../src/interactive/pagePublish')
  const { interactive, pages, page } = await setup()
  const forge = { resolve: async () => ({ kind: 'saved', token: 'gh' }), choiceId: () => 'saved' }
  const requests: string[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'me' }))
    if (url.includes('/contents/') && !init?.method) return new Response('', { status: 404 })
    return new Response('{}')
  }) as typeof fetch
  // Netlify and Vercel come from the hosting accounts deploys use; only Vercel is connected here.
  const hosting = { connected: (target: string) => target === 'vercel' }
  // Cloudflare Pages uses the token saved for the Cloudflare plugin.
  const plugins = {
    hasCredential: (name: string, slot: string) => name === 'cloudflare' && slot === 'token',
    credentialOf: async () => null,
  }
  const publisher = new PagePublisher(pages, () => forge as never, hosting as never, plugins, fetcher)
  await expect(publisher.publish(page.id, 'github-pages')).rejects.toThrow('Make it a project')
  const plain = interactive.publish('s', (await interactive.preview('s', { ...input, html: '<p>Trip</p>' })).id, 'p1')
  const trip = pages.keep('s', plain.id, { title: 'Trip costs' })
  const live = await publisher.publish(trip.id, 'github-pages')
  expect(live.published).toMatchObject({
    target: 'github-pages',
    url: 'https://me.github.io/trip-costs/',
    siteId: 'trip-costs',
    version: 1,
  })
  requests.length = 0
  await publisher.publish(trip.id, 'github-pages')
  expect(requests.some((request) => request.startsWith('POST') && request.endsWith('/user/repos'))).toBe(false)
  expect(publisher.targets().find((target) => target.target === 'github-pages')?.connected).toBe(true)
  expect(publisher.targets().find((target) => target.target === 'vercel')?.connected).toBe(true)
  expect(publisher.targets().find((target) => target.target === 'netlify')?.connected).toBe(false)
  expect(publisher.targets().find((target) => target.target === 'cloudflare-pages')?.connected).toBe(true)
})

it('publishes to Cloudflare Pages with the Cloudflare plugin’s token and the account saved beside it', async () => {
  const { PagePublisher } = await import('../src/interactive/pagePublish')
  const { interactive, pages } = await setup()
  const requests: { url: string; auth: string }[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, auth: String((init?.headers as Record<string, string>)?.Authorization) })
    return new Response(JSON.stringify(url.endsWith('/upload-token') ? { result: { jwt: 'upload' } } : {}))
  }) as typeof fetch
  const saved = { token: 'cf_token', fields: { account: 'acc_1' }, account: 'Ana' }
  const plugins = { hasCredential: () => true, credentialOf: vi.fn(async () => saved) }
  const publisher = new PagePublisher(pages, () => undefined, undefined, plugins, fetcher)
  const plain = interactive.publish('s', (await interactive.preview('s', { ...input, html: '<p>Trip</p>' })).id, 'p1')
  const trip = pages.keep('s', plain.id, { title: 'Trip costs' })
  const live = await publisher.publish(trip.id, 'cloudflare-pages')
  expect(plugins.credentialOf).toHaveBeenCalledWith('cloudflare', 'token')
  expect(live.published).toMatchObject({ target: 'cloudflare-pages', url: 'https://trip-costs.pages.dev' })
  expect(requests[0]).toEqual({
    url: 'https://api.cloudflare.com/client/v4/accounts/acc_1/pages/projects',
    auth: 'Bearer cf_token',
  })
  const missing = new PagePublisher(pages, () => undefined, undefined, {
    hasCredential: () => false,
    credentialOf: async () => null,
  })
  expect(missing.targets().find((target) => target.target === 'cloudflare-pages')?.connected).toBe(false)
  await expect(missing.publish(trip.id, 'cloudflare-pages')).rejects.toThrow('Install the Cloudflare plugin')
})

it('reads Ramu data only for the sources declared and allowed, scoped to the page project', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const { interactive, pages } = await setup()
  const declared = { ramu: { purpose: 'My usage dashboard', sources: ['activity', 'threads'] } }
  const v = interactive.publish('s', (await interactive.preview('s', { ...input, html: html(declared) })).id, 'rd')
  const page = pages.keep('s', v.id, { projectId: 'p' })
  const listTasks = vi.fn(() => [{ title: 'Fix login', status: 'idle', doneAt: null, lastActiveAt: 0, id: 't' }])
  const methods = registerArtifactHandlers({
    pages,
    pageAi: new PageAi(
      pages,
      async () => ({ message: '', provider: 'codex', model: 'm' }),
      () => DEFAULT_AGENT_SETTINGS,
    ),
    workspace: { listTasks },
    agents: { activity: () => [{ day: '2026-11-06', provider: 'codex', tokens: 10 }] },
    activity: { run: (_l: string, _d: string, work: () => unknown) => work() },
  } as never)
  const read = (source: string) => methods['artifacts.call']!.run(page.id, 'ramu.read', [source])
  expect(() => read('activity')).toThrow('not allowed')
  pages.grant(page.id, { ramu: ['threads'] })
  expect(() => read('activity')).toThrow('not allowed')
  expect(read('threads')).toEqual([
    { title: 'Fix login', status: 'idle', done: false, lastActiveAt: '1970-01-01T00:00:00.000Z' },
  ])
  expect(listTasks).toHaveBeenCalledWith('p')
  expect(() => read('pullRequests')).toThrow('did not declare')
})

it('queries a plugin data source only when the page declared it and the person allowed it', async () => {
  const { registerArtifactHandlers } = await import('../src/ipc/handlers/artifacts')
  const { interactive, pages } = await setup()
  const declared = { services: { purpose: 'Signups beside errors', services: ['grafana'] } }
  const v = interactive.publish('s', (await interactive.preview('s', { ...input, html: html(declared) })).id, 'sv')
  const page = pages.keep('s', v.id, { projectId: 'p' })
  const pluginQuery = vi.fn(async () => [{ Value: 3 }])
  const methods = registerArtifactHandlers({
    pages,
    pageAi: new PageAi(
      pages,
      async () => ({ message: '', provider: 'codex', model: 'm' }),
      () => DEFAULT_AGENT_SETTINGS,
    ),
    plugins: { query: pluginQuery },
    activity: { run: (_l: string, _d: string, work: () => unknown) => work() },
  } as never)
  const query = (spec: Record<string, unknown>) => methods['artifacts.call']!.run(page.id, 'services.query', [spec])
  const grafana = { id: 'grafana', datasource: 'prom1', query: { expr: 'up' }, columns: ['Value'] }
  await expect(query(grafana)).rejects.toThrow('not allowed to read grafana')
  await expect(query({ id: 'amplitude', event: 'Signed up', columns: ['value'] })).rejects.toThrow(
    'did not declare amplitude',
  )
  expect(pluginQuery).not.toHaveBeenCalled()
  pages.grant(page.id, { services: ['grafana'] })
  // Allowed, the query reaches the plugin with the data source's own fields, the columns asked for and the project.
  await expect(query(grafana)).resolves.toEqual([{ Value: 3 }])
  expect(pluginQuery).toHaveBeenCalledWith(
    'grafana',
    { id: 'grafana', datasource: 'prom1', query: { expr: 'up' } },
    ['Value'],
    5000,
    // The page's project, so a value of the credential kept for its identity is used.
    'p',
  )
})

it('opens a page to people without Ramu on its own listener that serves only that page', async () => {
  const { PublicPages } = await import('../src/interactive/publicPages')
  const { interactive, pages, page } = await setup()
  const used: unknown[] = []
  const tunnel = () =>
    ({
      use: (choice: unknown, target: unknown) => used.push([choice, target]),
      stop: () => used.push('stopped'),
      status: () => ({ state: 'running', error: null }),
      address: () => 'https://abc.trycloudflare.com',
    }) as never
  let saved: string[] = []
  const open = new PublicPages(pages, { read: () => saved, write: (ids) => void (saved = ids) }, tunnel)
  await expect(open.start(page.id, { kind: 'quick' })).rejects.toThrow('cannot be opened')
  const plain = interactive.publish('s', (await interactive.preview('s', { ...input, html: '<p>Trip</p>' })).id, 'pp')
  const trip = pages.keep('s', plain.id, { title: 'Trip' })
  await expect(open.start(trip.id, { kind: 'tailscale' })).rejects.toThrow('own name')
  const status = await open.start(trip.id, { kind: 'quick' })
  expect(status).toMatchObject({ state: 'running', url: 'https://abc.trycloudflare.com' })
  const port = open.port(trip.id)!
  expect(used[0]).toEqual([{ kind: 'quick' }, `http://127.0.0.1:${port}`])
  expect(saved).toEqual([trip.id])
  const home = await fetch(`http://127.0.0.1:${port}/`)
  expect(home.status).toBe(200)
  expect(home.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
  expect(await home.text()).toContain('<p>Trip</p>')
  expect((await fetch(`http://127.0.0.1:${port}/socket`)).status).toBe(404)
  expect((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status).toBe(405)
  open.stop(trip.id)
  expect(saved).toEqual([])
  expect(open.status(trip.id).state).toBe('off')
})

it('fills an artifact file from an image attachment the thread holds, and refuses without a way to read one', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { ToolRegistry } = await import('../src/agent/toolRegistry')
  const { registerInteractiveTools } = await import('../src/interactive/tools')
  const preview = vi.fn(async (_session: string, _input: { files?: object[] }) => ({
    id: 'x',
    version: 1,
    errors: [] as string[],
  }))
  const store = { preview } as never
  const id = '11111111-2222-4333-8444-555555555555'
  const attachment = vi.fn(async () => Buffer.from('png-bytes'))
  const input = {
    kind: 'slides',
    title: 'Deck',
    summary: 'S',
    slides: [{ layout: 'image', title: 'Hero', image: { path: 'hero.png', alt: 'A hero' } }],
    files: [{ path: 'hero.png', attachment: id }],
  }
  const extra = { signal: new AbortController().signal } as never
  const registry = new ToolRegistry(new McpServer({ name: 'test', version: '1' }), true)
  registerInteractiveTools(registry.server, store, 's', {
    pages: { has: () => false } as never,
    ai: {} as never,
    projectId: () => null,
    attachment,
  })
  await registry.invoke('artifact_preview', input, extra)
  expect(attachment).toHaveBeenCalledWith(id)
  expect(preview.mock.calls[0]![1]).toMatchObject({
    files: [{ path: 'hero.png', content: Buffer.from('png-bytes').toString('base64'), encoding: 'base64' }],
  })
  expect(preview.mock.calls[0]![1].files![0]).not.toHaveProperty('attachment')
  const bare = new ToolRegistry(new McpServer({ name: 'test', version: '1' }), true)
  registerInteractiveTools(bare.server, store, 's')
  expect((await bare.invoke('artifact_preview', input, extra)).isError).toBe(true)
})
