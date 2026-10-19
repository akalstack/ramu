import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { InteractiveStore, type InteractiveInput } from '../src/interactive/store'
import { previewInteractive, interactiveBrowserPath } from '../src/interactive/preview'
import { registerInteractiveTools } from '../src/interactive/tools'
import { ToolRegistry } from '../src/agent/toolRegistry'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
const db = (): Db => {
  const db = openDb(':memory:')
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','P',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','T','current','idle',0); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES('s','t','codex','/tmp','idle',0),('other','t','codex','/tmp','idle',0)",
  )
  databases.push(db)
  return db
}
const databases: Db[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const input: InteractiveInput = {
  title: 'Capacity',
  summary: 'Adjust capacity.',
  html: '<label>People <input type="number" value="2" oninput="document.querySelector(\'output\').textContent=this.value*3"></label><output>6</output>',
  checks: [{ action: 'fill', label: 'People', value: '4', expect: '12' }],
}
const previewer = async () => ({
  screenshot: 'data:image/png;base64,AA==',
  height: 400,
  checks: [{ label: 'People', passed: true, detail: '12' }],
  errors: [] as string[],
})
it('persists exact versions, enforces ownership and retries without adding versions', async () => {
  const d = db(),
    record = vi.fn(),
    store = new InteractiveStore(d, record, previewer)
  const first = await store.preview('s', input)
  expect(() => store.publish('other', first.id, 'wrong')).toThrow('another session')
  const v1 = store.publish('s', first.id, 'r1')
  expect(store.publish('s', first.id, 'r1')).toEqual(v1)
  expect(store.list('s')).toHaveLength(1)
  expect(() => store.get('other', v1.id, 1)).toThrow('not found')
  const second = await store.preview('s', { ...input, html: input.html + '<p>New version</p>' })
  expect(() => store.publish('s', second.id, 'r1')).toThrow('different publication')
  const v2 = store.publish('s', second.id, 'r2', { id: v1.id, version: 1 })
  expect(v2).toMatchObject({ id: v1.id, version: 2 })
  expect(() => store.publish('s', second.id, 'r3', { id: v1.id, version: 1 })).toThrow('changed')
  expect(store.get('s', v1.id, 1).html).toBe(input.html)
  const reopened = new InteractiveStore(d, record, previewer)
  expect(reopened.get('s', v2.id, 2).html).toContain('New version')
  expect(record).toHaveBeenCalledWith('s', v2)
})
it('refuses failed, expired, changed and oversized previews', async () => {
  const d = db(),
    store = new InteractiveStore(
      d,
      () => {},
      async () => ({ ...(await previewer()), errors: ['Broken script'] }),
    )
  const p = await store.preview('s', input)
  expect(() => store.publish('s', p.id, 'a')).toThrow('Fix preview')
  d.prepare('UPDATE interactive_previews SET input=? WHERE id=?').run(
    JSON.stringify({ ...input, html: 'changed' }),
    p.id,
  )
  expect(() => store.publish('s', p.id, 'a')).toThrow('digest')
  d.prepare('UPDATE interactive_previews SET created_at=0').run()
  expect(() => store.publish('s', p.id, 'a')).toThrow('expired')
  await expect(store.preview('s', { ...input, html: '😀'.repeat(150_000) })).rejects.toThrow('512 KB')
  const controller = new AbortController()
  controller.abort()
  await expect(store.preview('s', input, controller.signal)).rejects.toThrow('cancelled')
})
it('publishes through the portable provider wrapper using the same canonical callback', async () => {
  const d = db(),
    record = vi.fn(),
    store = new InteractiveStore(d, record, previewer)
  const registry = new ToolRegistry(new McpServer({ name: 'test', version: '1' }), true)
  registerInteractiveTools(registry.server, store, 's')
  expect(registry.search('interactive', 10).some((v) => v.name === 'preview_interactive')).toBe(true)
  const p = await store.preview('s', input)
  const extra = { signal: new AbortController().signal } as Parameters<typeof registry.invoke>[2]
  const result = await registry.invoke('publish_interactive', { previewId: p.id, requestId: 'wrapper' }, extra)
  expect(result.isError).not.toBe(true)
  expect(record).toHaveBeenCalledTimes(1)
  expect(record.mock.calls[0]?.[1]).toMatchObject({ title: 'Capacity', checked: true })
  const forbidden = await registry.invoke('interactive_read', { id: 'forged', version: 1 }, extra)
  expect(forbidden.isError).toBe(true)
})
it.skipIf(!interactiveBrowserPath())(
  'uses an isolated real preview browser to observe a working control and diagnose broken behavior',
  async () => {
    const result = await previewInteractive(input.html, input.checks)
    expect(result.errors).toEqual([])
    expect(result.checks[0]?.passed).toBe(true)
    expect(result.layouts).toEqual([
      expect.objectContaining({ width: 390, overflow: false }),
      expect.objectContaining({ width: 900, overflow: false }),
    ])
    expect(result.screenshot).toMatch(/^data:image\/png;base64,/)
    const blocked = await previewInteractive(
      '<script>fetch("https://example.com/private").catch(()=>{});throw new Error("broken fixture")</script><p style="width:1200px">Fallback</p>',
      [],
    )
    expect(blocked.layouts?.every((layout) => layout.overflow)).toBe(true)
    expect(blocked.errors.join(' ')).toContain('broken fixture')
    expect(blocked.errors.join(' ')).toMatch(/Content Security Policy|connect-src|violates/)
  },
  30_000,
)

it('rolls back a publication if recording fails and never resurrects removed events on restart or retry', async () => {
  const d = db()
  let failing = true
  const record = vi.fn((session: string, ref: unknown) => {
    d.prepare('INSERT INTO agent_events(session_id,seq,event) VALUES(?,1,?)').run(
      session,
      JSON.stringify({ kind: 'interactive', reference: ref }),
    )
    if (failing) throw new Error('Recording interrupted')
  })
  const store = new InteractiveStore(d, record, previewer)
  const preview = await store.preview('s', input)
  expect(() => store.publish('s', preview.id, 'atomic')).toThrow('interrupted')
  expect(store.list('s')).toEqual([])
  expect(d.prepare('SELECT COUNT(*) AS n FROM agent_events').get()).toEqual({ n: 0 })
  failing = false
  const reference = store.publish('s', preview.id, 'atomic')
  d.prepare('DELETE FROM agent_events WHERE session_id=?').run('s')
  const reopened = new InteractiveStore(d, record, previewer)
  expect(reopened.publish('s', preview.id, 'atomic')).toEqual(reference)
  expect(d.prepare('SELECT COUNT(*) AS n FROM agent_events').get()).toEqual({ n: 0 })
})

it.each([false, true])('uses the real MCP boundary for direct/deferred publication (deferred=%s)', async (deferred) => {
  const d = db()
  const record = vi.fn((session: string, reference: unknown) => {
    d.prepare('INSERT INTO agent_events(session_id,seq,event) VALUES(?,1,?)').run(
      session,
      JSON.stringify({ kind: 'interactive', reference }),
    )
  })
  const store = new InteractiveStore(d, record, previewer)
  const server = new McpServer({ name: 'ramu-content', version: '1' })
  const registry = new ToolRegistry(server, deferred)
  registerInteractiveTools(registry.server, store, 's')
  registry.expose()
  const client = new Client({ name: 'provider', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(left), client.connect(right)])
  try {
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool(
        deferred ? { name: 'tool_invoke', arguments: { name, arguments: args } } : { name, arguments: args },
      )
    const preview = await call('preview_interactive', input)
    const blocks = preview.content as { type: string; text?: string }[]
    const previewId = JSON.parse(blocks.find((b) => b.type === 'text')!.text!).id
    const first = await call('publish_interactive', { previewId, requestId: 'retry' })
    const retry = await call('publish_interactive', { previewId, requestId: 'retry' })
    expect(retry).toEqual(first)
    expect(record).toHaveBeenCalledTimes(1)
    expect(d.prepare('SELECT COUNT(*) AS n FROM agent_events').get()).toEqual({ n: 1 })
    expect(store.list('s')).toHaveLength(1)
  } finally {
    await client.close()
    await server.close()
  }
})

it('binds the optional compatibility declaration to the preview and saved immutable reference', async () => {
  const store = new InteractiveStore(db(), () => {}, previewer)
  const preview = await store.preview('s', { ...input, stateSchema: 'capacity-v1' })
  const ref = store.publish('s', preview.id, 'schema')
  expect(ref.stateSchema).toBe('capacity-v1')
  expect(store.get('s', ref.id, 1).reference.stateSchema).toBe('capacity-v1')
  await expect(store.preview('s', { ...input, stateSchema: ' ' })).rejects.toThrow()
})
