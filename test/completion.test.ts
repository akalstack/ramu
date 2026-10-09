import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { CompletionService, definitionPattern, fitOf, identifiersAt, keyHost, recommendModel, summarize } from '../src/main/completion'
import { DEFAULT_APP_PREFERENCES, type AiCompletionPreferences } from '../src/shared/types'

let dir: string, server: Server, base: string, seen: { url: string; auth?: string; body: Record<string, unknown> }[], respond: (url: string) => { status: number; body: unknown; headers?: Record<string, string> }
let prefs: AiCompletionPreferences

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-completion-')); seen = []
  respond = (url) => url.startsWith('/api/tags') ? { status: 200, body: { models: [{ name: 'qwen2.5-coder:1.5b-base' }] } } : url.startsWith('/api/generate') ? { status: 200, body: { response: 'return a + b  \n' } } : { status: 200, body: { choices: [{ message: { content: 'a + b', role: 'assistant' } }] } }
  server = createServer((req: IncomingMessage, res) => {
    let raw = ''; req.on('data', (c) => raw += c); req.on('end', () => {
      seen.push({ url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : {} })
      const out = respond(req.url!); res.writeHead(out.status, { 'content-type': 'application/json', ...out.headers }); res.end(JSON.stringify(out.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  prefs = { enabled: true, provider: 'ollama', ollamaModel: 'qwen2.5-coder:1.5b-base', codestralModel: '', codestralUrl: base, nextEdit: false, nextEditAck: false }
})
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) })

// Reversible stand-in for the OS keychain.
const crypto = { available: () => true, encrypt: (text: string) => Buffer.from(`enc:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^enc:/, '') }
const service = (overrides: Partial<ConstructorParameters<typeof CompletionService>[0]> = {}) => new CompletionService({ preferences: async () => ({ ...DEFAULT_APP_PREFERENCES, aiCompletion: prefs }), keyFile: join(dir, 'key.json'), crypto, ollamaUrl: base, ...overrides })
const ask = (s: CompletionService, extra: Record<string, unknown> = {}) => s.complete({ requestId: 'r1', path: 'src/sum.ts', prefix: 'function sum(a, b) {\n  ', suffix: '\n}', ...extra } as never)

it('does nothing until completion is turned on', async () => {
  prefs.enabled = false
  expect(await ask(service())).toMatchObject({ status: 'disabled', text: '' }); expect(seen).toEqual([])
})

it('asks Ollama to fill in between the prefix and suffix with the base model', async () => {
  const result = await ask(service())
  expect(result).toMatchObject({ status: 'ok', text: 'return a + b' })
  expect(seen[0]!.body).toMatchObject({ model: 'qwen2.5-coder:1.5b-base', prompt: 'function sum(a, b) {\n  ', suffix: '\n}', stream: false, options: { temperature: 0 } })
})

it('explains a missing model or a stopped Ollama instead of failing silently', async () => {
  respond = () => ({ status: 404, body: { error: 'model not found' } })
  expect((await ask(service())).message).toContain('ollama pull qwen2.5-coder:1.5b-base')
  expect(await ask(service({ ollamaUrl: 'http://127.0.0.1:1' }))).toMatchObject({ status: 'unavailable', message: expect.stringContaining('not running') })
})

it('reports Ollama status and installed models', async () => {
  expect((await service().status()).ollama).toEqual({ running: true, models: ['qwen2.5-coder:1.5b-base'] })
  expect((await service({ ollamaUrl: 'http://127.0.0.1:1' }).status()).ollama.running).toBe(false)
})

it('keeps each provider\'s model separate, so switching never sends an Ollama model name to Mistral', async () => {
  prefs.provider = 'codestral'; prefs.ollamaModel = 'qwen2.5-coder:7b-base'; const s = service(); await s.setKey('secret-key-123'); await ask(s)
  expect(seen.at(-1)!.body.model).toBe('codestral-latest')
})

it('stores the Codestral key encrypted, bound to its host, and sends it only there', async () => {
  prefs.provider = 'codestral'; const s = service()
  expect(await ask(s)).toMatchObject({ status: 'no-key' })
  await s.setKey('secret-key-123')
  expect(readFileSync(join(dir, 'key.json'), 'utf8')).not.toContain('secret-key-123')
  expect(await ask(s)).toMatchObject({ status: 'ok', text: 'a + b' })
  expect(seen[0]).toMatchObject({ url: '/v1/fim/completions', auth: 'Bearer secret-key-123', body: { model: 'codestral-latest', prompt: 'function sum(a, b) {\n  ', suffix: '\n}' } })
  // Pointing the endpoint somewhere else must not release the saved key.
  prefs.codestralUrl = 'http://localhost:9'; seen = []
  expect(await ask(s)).toMatchObject({ status: 'no-key' }); expect(seen).toEqual([])
})

it('refuses to save a key without secure storage and to send one over plain http to another machine', async () => {
  prefs.provider = 'codestral'
  await expect(service({ crypto: { ...crypto, available: () => false } }).setKey('secret-key-123')).rejects.toThrow('Secure storage')
  expect(() => keyHost('http://example.com')).toThrow('https'); expect(keyHost('https://codestral.mistral.ai/v1/x')).toBe('https://codestral.mistral.ai')
})

it('backs off after a rate limit without calling the provider again', async () => {
  prefs.provider = 'codestral'; const s = service(); await s.setKey('secret-key-123')
  respond = () => ({ status: 429, body: {}, headers: { 'retry-after': '7' } })
  const limited = await ask(s)
  expect(limited).toMatchObject({ status: 'rate-limited', retryAfterMs: 7000 })
  const calls = seen.length
  expect((await ask(s)).status).toBe('rate-limited'); expect(seen.length).toBe(calls)
})

it('never sends files that can hold secrets to a cloud provider, but local models may read them', async () => {
  prefs.provider = 'codestral'; const s = service(); await s.setKey('secret-key-123')
  for (const path of ['.env', 'config/.env.local', 'certs/server.pem', 'deploy/id_rsa', 'secrets.json']) expect((await ask(s, { path })).status, path).toBe('skipped')
  expect(seen).toEqual([])
  prefs.provider = 'ollama'; expect((await ask(s, { path: '.env' })).status).toBe('ok')
})

it('sends a bounded amount of surrounding code and skips an empty document', async () => {
  await ask(service(), { prefix: 'x'.repeat(50_000), suffix: 'y'.repeat(50_000) })
  expect((seen[0]!.body.prompt as string).length).toBe(4000); expect((seen[0]!.body.suffix as string).length).toBe(1500)
  seen = []; expect((await ask(service(), { prefix: '  ', suffix: '\n' })).status).toBe('skipped'); expect(seen).toEqual([])
})

it('cancels a request that is no longer needed', async () => {
  const slow = createServer(() => {}); await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve))
  const s = service({ ollamaUrl: `http://127.0.0.1:${(slow.address() as AddressInfo).port}` })
  const pending = ask(s, { requestId: 'stale' }); await new Promise((resolve) => setTimeout(resolve, 150)); await s.handle('completion.cancel', ['stale'])
  expect((await pending).status).toBe('skipped'); slow.closeAllConnections(); await new Promise((resolve) => slow.close(resolve))
})

it('recommends a model that fits the machine without crowding memory', () => {
  const mac = (memoryGb: number) => recommendModel({ memoryGb, unifiedMemory: true, gpuMemoryGb: null }).recommended
  expect([8, 16, 24, 32, 48, 64, 128].map(mac)).toEqual(['qwen2.5-coder:1.5b-base', 'qwen2.5-coder:3b-base', 'qwen2.5-coder:7b-base', 'qwen2.5-coder:7b-base', 'qwen2.5-coder:14b-base', 'qwen2.5-coder:14b-base', 'qwen2.5-coder:14b-base'])
  // CPU-only machines stay small whatever their RAM, and a discrete GPU is judged by its own memory.
  expect(recommendModel({ memoryGb: 64, unifiedMemory: false, gpuMemoryGb: null }).recommended).toBe('qwen2.5-coder:1.5b-base')
  expect(recommendModel({ memoryGb: 32, unifiedMemory: false, gpuMemoryGb: 8 }).recommended).toBe('qwen2.5-coder:7b-base')
  expect(recommendModel({ memoryGb: 8, unifiedMemory: true, gpuMemoryGb: null }).recommended).toBe('qwen2.5-coder:1.5b-base')
  const hardware = { memoryGb: 16, gpuMemoryGb: null }, budget = recommendModel({ ...hardware, unifiedMemory: true }).budgetGb
  expect([0.99, 4.68, 19.85].map((size) => fitOf(size, hardware, budget))).toEqual(['fits', 'tight', 'too-large'])
})

it('lists the catalog with fit and install state, and keeps other installed models selectable', async () => {
  respond = (url) => url.startsWith('/api/tags') ? { status: 200, body: { models: [{ name: 'qwen2.5-coder:1.5b-base' }, { name: 'llama3.2:3b' }] } } : { status: 200, body: {} }
  const status = await service().status()
  expect(status.options.map((o) => o.id)).toEqual(['qwen2.5-coder:1.5b-base', 'qwen2.5-coder:3b-base', 'qwen2.5-coder:7b-base', 'qwen2.5-coder:14b-base', 'qwen2.5-coder:32b-base', 'llama3.2:3b'])
  expect(status.options.filter((o) => o.fit === 'recommended')).toHaveLength(1)
  expect(status.options.find((o) => o.id === status.recommended)!.fit).toBe('recommended')
  expect(status.options.find((o) => o.id === 'qwen2.5-coder:1.5b-base')).toMatchObject({ installed: true, curated: true }); expect(status.options.find((o) => o.id === 'llama3.2:3b')).toMatchObject({ installed: true, curated: false })
  expect(status.hardware.memoryGb).toBeGreaterThan(0)
})

it('uses the recommended model when none is chosen, and the chosen model when one is', async () => {
  const { recommended } = await service().status()
  prefs.ollamaModel = ''; await ask(service()); expect(seen.at(-1)!.body.model).toBe(recommended)
  prefs.ollamaModel = 'qwen2.5-coder:7b-base'; await ask(service()); expect(seen.at(-1)!.body.model).toBe('qwen2.5-coder:7b-base')
})

it('downloads a model on request and reports progress, and surfaces a failure', async () => {
  const events: any[] = []
  const stream = createServer((_req, res) => { res.writeHead(200); res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n'); res.write(JSON.stringify({ status: 'pulling abc', total: 100, completed: 40 }) + '\n'); res.end(JSON.stringify({ status: 'success' }) + '\n') })
  await new Promise<void>((resolve) => stream.listen(0, '127.0.0.1', resolve))
  const s = service({ ollamaUrl: `http://127.0.0.1:${(stream.address() as AddressInfo).port}`, notify: (_channel, payload) => events.push(payload) })
  await s.handle('completion.pull', ['qwen2.5-coder:3b-base'])
  expect(events.map((e) => [e.status, e.completed, e.total, e.done])).toEqual([['pulling manifest', 0, 0, false], ['pulling abc', 40, 100, false], ['success', 0, 0, false], ['success', 0, 0, true]])
  await expect(s.handle('completion.pull', ['bad name; rm'])).rejects.toThrow()
  stream.closeAllConnections(); await new Promise((resolve) => stream.close(resolve))
  events.length = 0; await service({ ollamaUrl: 'http://127.0.0.1:1', notify: (_c, p) => events.push(p) }).handle('completion.pull', ['qwen2.5-coder:3b-base'])
  expect(events.at(-1)).toMatchObject({ done: true, error: expect.stringContaining('not running') })
})

const files: Record<string, string> = { 'src/util.ts': 'export function slugify(text: string): string { return text }\n', 'src/lib/index.ts': 'export const VERSION = 1\n' }
const withFiles = () => service({ readFile: async (_t, _r, path) => files[path] ?? null })
const prompt = () => seen.at(-1)!.body.prompt as string

it('gives a Qwen coder model the user\'s open files and the files the current file imports, ahead of the current file', async () => {
  prefs.ollamaModel = 'qwen2.5-coder:1.5b-base'
  await ask(withFiles(), { taskId: 't', repoId: 'r', path: 'src/app.ts', prefix: "import { slugify } from './util'\nimport { VERSION } from './lib'\nslug", suffix: '', context: [{ path: 'src/open.ts', content: 'export const open = true' }] })
  expect(prompt()).toBe("<|file_sep|>src/open.ts\nexport const open = true\n<|file_sep|>src/util.ts\nexport function slugify(text: string): string { return text }\n<|file_sep|>src/lib/index.ts\nexport const VERSION = 1\n<|file_sep|>src/app.ts\nimport { slugify } from './util'\nimport { VERSION } from './lib'\nslug")
})

it('sends no extra context to models that would read it as part of the file, or when there is none', async () => {
  prefs.ollamaModel = 'llama3.2:3b'
  await ask(withFiles(), { taskId: 't', repoId: 'r', path: 'src/app.ts', prefix: "import { slugify } from './util'\nslug", context: [{ path: 'src/open.ts', content: 'x' }] })
  expect(prompt()).toBe("import { slugify } from './util'\nslug")
  prefs.ollamaModel = 'qwen2.5-coder:1.5b-base'
  await ask(withFiles(), { path: 'src/app.ts', prefix: 'const a = 1\n' }); expect(prompt()).toBe('const a = 1\n')
})

it('stays inside the repository, skips the current file, and never repeats a file', async () => {
  prefs.ollamaModel = 'qwen2.5-coder:1.5b-base'
  await ask(withFiles(), { taskId: 't', repoId: 'r', path: 'src/app.ts', prefix: "import a from '../../outside'\nimport { slugify } from './util'\nimport { slugify as again } from './util.ts'\nx", context: [{ path: 'src/app.ts', content: 'self' }, { path: 'src/util.ts', content: 'export const dup = 1' }] })
  expect(prompt().match(/<\|file_sep\|>/g)).toHaveLength(2); expect(prompt()).toContain('<|file_sep|>src/util.ts\nexport const dup = 1\n<|file_sep|>src/app.ts\n'); expect(prompt()).not.toContain('<|file_sep|>outside')
})

it('keeps context within its budget and summarizes large files to their exported declarations', async () => {
  prefs.ollamaModel = 'qwen2.5-coder:1.5b-base'
  const big = Array.from({ length: 200 }, (_, i) => `const hidden${i} = ${i}\nexport function visible${i}() {}`).join('\n')
  expect(summarize(big)).toContain('export function visible0()'); expect(summarize(big)).not.toContain('hidden0'); expect(summarize(big).length).toBeLessThanOrEqual(1500)
  await ask(service(), { path: 'x.ts', prefix: 'a', context: Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.ts`, content: big })) })
  expect(prompt().length).toBeLessThan(5000 + 400)
})

// Opt-in, with a running Ollama that has qwen2.5-coder:1.5b-base: does repository context make the model use names it cannot see?
it.skipIf(!process.env.RAMU_LIVE_OLLAMA)('live: context lets the local model complete names defined in another file', async () => {
  const cases = [
    { file: 'src/queue.ts', code: 'export class OrderQueue {\n  enqueueUrgent(order: Order) {}\n  drainAll() {}\n}\n', prefix: "import { OrderQueue } from './queue'\nconst queue = new OrderQueue()\nqueue.enqueueUr", expect: 'gent' },
    { file: 'src/money.ts', code: 'export function formatInvoiceTotal(items: LineItem[], taxRate: number): string { return "" }\n', prefix: "import { formatInvoiceTotal } from './money'\nconst label = formatInvoiceTotal(items, ", expect: 'taxRate' },
    { file: 'src/flags.ts', code: 'export const FEATURE_FLAGS = { betaDashboard: false, newCheckout: true }\n', prefix: "import { FEATURE_FLAGS } from './flags'\nif (FEATURE_FLAGS.newCheck", expect: 'out' },
    { file: 'src/events.ts', code: "export type AppEvent = 'session-started' | 'session-expired' | 'session-renewed'\n", prefix: "import type { AppEvent } from './events'\nconst e: AppEvent = 'session-ren", expect: 'ewed' },
    { file: 'src/geo.ts', code: 'export function haversineKm(a: Point, b: Point): number { return 0 }\n', prefix: "import { haversineKm } from './geo'\nconst distance = haversine", expect: 'Km' },
    { file: 'src/user.ts', code: 'export interface UserProfile { displayName: string; avatarUrl: string; lastSeenAt: Date }\n', prefix: "import type { UserProfile } from './user'\nfunction show(p: UserProfile) {\n  return p.last", expect: 'SeenAt' },
  ]
  prefs.provider = 'ollama'; prefs.ollamaModel = process.env.RAMU_LIVE_MODEL ?? 'qwen2.5-coder:1.5b-base'
  const live = new CompletionService({ preferences: async () => ({ ...DEFAULT_APP_PREFERENCES, aiCompletion: prefs }), keyFile: join(dir, 'k.json'), crypto, readFile: async (_t, _r, path) => cases.find((c) => c.file === path)?.code ?? null })
  let withContext = 0, without = 0
  for (const c of cases) {
    const a = await live.complete({ requestId: 'a', taskId: 't', repoId: 'r', path: 'src/app.ts', prefix: c.prefix, suffix: '\n', context: [] }), b = await live.complete({ requestId: 'b', path: 'src/app.ts', prefix: c.prefix, suffix: '\n', context: [] } as never)
    if (a.text.includes(c.expect)) withContext++; if (b.text.includes(c.expect)) without++
    console.log(c.expect.padEnd(10), 'with:', JSON.stringify(a.text.slice(0, 60)), '| without:', JSON.stringify(b.text.slice(0, 60)))
  }
  console.log(`RESULT with context ${withContext}/${cases.length}, without ${without}/${cases.length}`)
  expect(withContext).toBeGreaterThanOrEqual(without)
}, 180_000)

it('picks the identifiers around the cursor, the word being typed first, and skips keywords and what the file defines', () => {
  const picked = identifiersAt("function localHelper() {}\nimport { OrderQueue } from './queue'\nconst queue = new OrderQueue()\nqueue.enqueueUr", '\nreturn localHelper()')
  expect(picked[0]).toEqual({ name: 'enqueueUr', partial: true })
  expect(picked.map((p) => p.name)).toContain('OrderQueue'); expect(picked.map((p) => p.name)).not.toContain('localHelper'); expect(picked.map((p) => p.name)).not.toContain('return')
  expect(identifiersAt('const total = ', '')).toEqual([])
})

it('builds a definition search that matches declarations and methods but not calls', () => {
  const re = (name: string, partial: boolean) => new RegExp(definitionPattern(name, partial), 'm')
  for (const line of ['export function formatTotal(items) {', 'class OrderQueue {', 'def format_total(items):', 'func (q *Queue) Drain() {', 'pub fn format_total(x: i32)', 'const formatTotal = (items) =>']) expect(re(line.match(/(formatTotal|OrderQueue|format_total|Drain)/)![1]!, false).test(line), line).toBe(true)
  expect(re('enqueueUr', true).test('  async enqueueUrgent(order: Order): Promise<void> {')).toBe(true)
  expect(re('enqueueUr', true).test('  enqueueUrgent: (order) => {}')).toBe(true)
  expect(re('enqueueUr', true).test('queue.enqueueUrgent(order)')).toBe(false)
  expect(re('format', false).test('const formatTotal = 1')).toBe(false)
})

const repo: Record<string, string> = {
  'src/orders/queue.ts': 'export class OrderQueue {\n  enqueueUrgent(order: Order): void {\n    this.items.unshift(order)\n  }\n}\n',
  'src/orders/queue.test.ts': 'describe("x", () => {\n  enqueueUrgent(order) {\n  }\n})\n',
  'src/app.ts': 'enqueueUrgent(self) {}',
}
let searches: string[]
const withRepo = (extra = {}) => { searches = []; return service({ readFile: async (_t, _r, path) => repo[path] ?? null, search: async (_t, _r, pattern) => { searches.push(pattern); const re = new RegExp(pattern, 'm'); return Object.entries(repo).flatMap(([path, text]) => text.split('\n').flatMap((line, i) => re.test(line) ? [{ path, line: i + 1 }] : [])) }, ...extra }) }
const askAbout = (s: CompletionService, extra = {}) => ask(s, { taskId: 't', repoId: 'r', path: 'src/app.ts', prefix: 'const queue = makeQueue()\nqueue.enqueueUr', suffix: '', ...extra })

it('finds definitions in files the user has not opened or imported, source before tests, current file excluded', async () => {
  prefs.ollamaModel = 'qwen2.5-coder:1.5b-base'
  await askAbout(withRepo())
  expect(prompt()).toBe('<|file_sep|>src/orders/queue.ts\n  enqueueUrgent(order: Order): void {\n    this.items.unshift(order)\n  }\n}\n<|file_sep|>src/app.ts\nconst queue = makeQueue()\nqueue.enqueueUr')
})

it('remembers lookups briefly, and never lets a slow search delay the suggestion', async () => {
  prefs.ollamaModel = 'qwen2.5-coder:1.5b-base'
  const s = withRepo(); await askAbout(s); const first = searches.length; await askAbout(s); expect(searches.length).toBe(first)
  const slow = service({ readFile: async () => 'x', search: () => new Promise(() => {}) }); const started = Date.now()
  expect((await askAbout(slow)).status).toBe('ok'); expect(Date.now() - started).toBeLessThan(2000); expect(prompt()).toBe('const queue = makeQueue()\nqueue.enqueueUr')
})

it('does no repository search for models without file context', async () => {
  prefs.ollamaModel = 'llama3.2:3b'; const s = withRepo(); await askAbout(s); expect(searches).toEqual([])
})

// Opt-in: files that are neither open nor imported. Search stands in for the repository; the point is whether the model uses what it finds.
it.skipIf(!process.env.RAMU_LIVE_OLLAMA)('live: retrieval finds definitions in files that are not open or imported', async () => {
  const code: Record<string, string> = {
    'src/orders/queue.ts': 'export class OrderQueue {\n  enqueueUrgent(order: Order) {}\n  drainAll() {}\n}\n',
    'src/billing/money.ts': 'export function formatInvoiceTotal(items: LineItem[], taxRate: number): string { return "" }\n',
    'src/config/flags.ts': 'export const FEATURE_FLAGS = { betaDashboard: false, newCheckout: true }\n',
    'src/geo/distance.ts': 'export function haversineKm(a: Point, b: Point): number { return 0 }\n',
    'src/users/profile.ts': 'export interface UserProfile { displayName: string; avatarUrl: string; lastSeenAt: Date }\n',
    'src/mail/send.ts': 'export async function sendWelcomeEmail(address: string, locale: Locale): Promise<void> {}\n',
  }
  const cases = [
    { prefix: 'const queue = makeQueue()\nqueue.enqueueUr', expect: 'gent' },
    { prefix: 'const label = formatInvoiceTotal(items, ', expect: 'taxRate' },
    { prefix: 'if (FEATURE_FLAGS.newCheck', expect: 'out' },
    { prefix: 'const distance = haversine', expect: 'Km' },
    { prefix: 'function show(p) {\n  return p.last', expect: 'SeenAt' },
    { prefix: 'await sendWelcomeEmail(user.email, ', expect: 'locale' },
  ]
  prefs.provider = 'ollama'; prefs.ollamaModel = process.env.RAMU_LIVE_MODEL ?? 'qwen2.5-coder:1.5b-base'
  const base = { preferences: async () => ({ ...DEFAULT_APP_PREFERENCES, aiCompletion: prefs }), keyFile: join(dir, 'k.json'), crypto }
  const searching = new CompletionService({ ...base, readFile: async (_t, _r, path) => code[path] ?? null, search: async (_t, _r, pattern) => { const re = new RegExp(pattern, 'm'); return Object.entries(code).flatMap(([path, text]) => text.split('\n').flatMap((line, i) => re.test(line) ? [{ path, line: i + 1 }] : [])) } })
  const plain = new CompletionService(base)
  let withSearch = 0, without = 0
  for (const c of cases) {
    const a = await searching.complete({ requestId: 'a', taskId: 't', repoId: 'r', path: 'src/app.ts', prefix: c.prefix, suffix: '\n', context: [] }), b = await plain.complete({ requestId: 'b', path: 'src/app.ts', prefix: c.prefix, suffix: '\n', context: [] } as never)
    if (a.text.includes(c.expect)) withSearch++; if (b.text.includes(c.expect)) without++
    console.log(c.expect.padEnd(10), 'with:', JSON.stringify(a.text.slice(0, 50)), '| without:', JSON.stringify(b.text.slice(0, 50)))
  }
  console.log(`RESULT retrieval ${withSearch}/${cases.length}, without ${without}/${cases.length}`)
  expect(withSearch).toBeGreaterThanOrEqual(without)
}, 180_000)

const editRequest = { requestId: 'e1', path: 'a.ts', lines: ['const a = 10', 'const b = 2'], cursorLine: 1, edits: [{ line: 1, before: ['const a = 1'], after: ['const a = 10'] }] }
const chatEdit = { status: 200, body: { choices: [{ message: { role: 'assistant', content: JSON.stringify({ edit: true, startLine: 2, endLine: 2, replacement: 'const b = 20' }) } }] } }
const nextEdit = (s: CompletionService, extra = {}) => s.handle('completion.nextEdit', [{ ...editRequest, ...extra }]) as Promise<any>

it('predicts the next edit with Codestral only after the user has allowed it, and never with a local model', async () => {
  respond = (url) => url.startsWith('/v1/chat/completions') ? chatEdit : { status: 200, body: {} }
  prefs.provider = 'codestral'; const s = service(); await s.setKey('secret-key-123')
  expect((await nextEdit(s)).status).toBe('disabled')
  prefs.nextEdit = true
  expect(await nextEdit(s)).toMatchObject({ status: 'unavailable', message: expect.stringContaining('Confirm in Settings') }); expect(seen).toEqual([])
  prefs.nextEditAck = true
  expect(await nextEdit(s)).toMatchObject({ status: 'ok', edit: { startLine: 2, endLine: 2, text: 'const b = 20' } })
  const sent = seen.at(-1)!
  expect(sent).toMatchObject({ url: '/v1/chat/completions', auth: 'Bearer secret-key-123', body: { model: 'codestral-latest', temperature: 0, response_format: { type: 'json_object' } } })
  expect((sent.body.messages as any[])[1].content).toContain('- const a = 1')
  prefs.provider = 'ollama'; seen = []; expect(await nextEdit(s)).toMatchObject({ status: 'unavailable', message: expect.stringContaining('Codestral') }); expect(seen).toEqual([])
})

it('keeps secrets out of next-edit requests, backs off after a rate limit, and reports a rejected key', async () => {
  prefs.provider = 'codestral'; prefs.nextEdit = true; prefs.nextEditAck = true; const s = service(); await s.setKey('secret-key-123')
  expect((await nextEdit(s, { path: 'config/.env.local' })).status).toBe('skipped'); expect(seen).toEqual([])
  respond = () => ({ status: 401, body: {} }); expect(await nextEdit(s)).toMatchObject({ status: 'unavailable', message: expect.stringContaining('rejected') })
  respond = () => ({ status: 429, body: {}, headers: { 'retry-after': '9' } }); expect((await nextEdit(s)).message).toContain('Rate limited')
  const calls = seen.length; expect((await nextEdit(s)).message).toContain('Rate limited'); expect(seen.length).toBe(calls)
  const noKey = service({ keyFile: join(dir, 'missing.json') }); expect((await nextEdit(noKey)).message).toContain('API key')
})

