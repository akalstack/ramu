// Inline (ghost text) completion through a fill-in-the-middle model: local Ollama, or Mistral's Codestral.
// Requests are made here, not in the renderer, so the API key never reaches page code: it is encrypted with
// the OS keychain, bound to the host it was saved for, and only ever sent to that host.
import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, totalmem } from 'node:os'
import { dirname, posix } from 'node:path'
import { z } from 'zod'
import { predictNextEdit } from './nextEdit'
import type { AppPreferences, CompletionResult, CompletionStatus, HardwareInfo, NextEditResult, OllamaModelOption, PullProgress } from '../shared/types'

const MAX_PREFIX = 4000, MAX_SUFFIX = 1500, MAX_TOKENS = 96, TIMEOUT_MS = 8000
const DEFAULT_CODESTRAL_MODEL = 'codestral-latest'
/** Files that commonly hold secrets are never sent to a cloud provider. */
const SENSITIVE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks|kdbx)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i

/**
 * Base (not instruct) models with Ollama fill-in-the-middle support. The Qwen2.5-Coder family shares one template, and
 * the 1.5B build was checked against a live Ollama; sizes are the download sizes in Ollama's registry.
 */
export const OLLAMA_CATALOG = [
  { id: 'qwen2.5-coder:1.5b-base', label: 'Qwen2.5-Coder 1.5B', sizeGb: 0.99, note: 'Fastest. Good for 8 GB machines.' },
  { id: 'qwen2.5-coder:3b-base', label: 'Qwen2.5-Coder 3B', sizeGb: 1.93, note: 'Balanced speed and quality.' },
  { id: 'qwen2.5-coder:7b-base', label: 'Qwen2.5-Coder 7B', sizeGb: 4.68, note: 'Better suggestions on 16 GB or more.' },
  { id: 'qwen2.5-coder:14b-base', label: 'Qwen2.5-Coder 14B', sizeGb: 8.99, note: 'High quality. Wants 32 GB or more.' },
  { id: 'qwen2.5-coder:32b-base', label: 'Qwen2.5-Coder 32B', sizeGb: 19.85, note: 'Best local quality. Wants 64 GB or more.' },
] as const

const nextEditRequest = z.object({ requestId: z.string().min(1).max(100), path: z.string().max(4096), lines: z.array(z.string().max(2000)).max(5000), cursorLine: z.number().int().min(1), edits: z.array(z.object({ line: z.number().int().min(1), before: z.array(z.string().max(2000)).max(40), after: z.array(z.string().max(2000)).max(40) })).max(8) })

/**
 * Tab completion must answer in a fraction of a second while the editor, agents and browser share memory, so the
 * budget is a slice of memory rather than all of it. Machines without a GPU or unified memory stay small.
 */
export function recommendModel(hardware: Pick<HardwareInfo, 'memoryGb' | 'unifiedMemory' | 'gpuMemoryGb'>): { recommended: string; budgetGb: number } {
  const budgetGb = hardware.gpuMemoryGb ? hardware.gpuMemoryGb * 0.8 - 1 : hardware.unifiedMemory ? hardware.memoryGb * 0.2 : Math.min(hardware.memoryGb * 0.15, 1.5)
  // Larger than 14B is offered but never picked automatically.
  const pick = [...OLLAMA_CATALOG].filter((model) => model.sizeGb <= 9 && model.sizeGb <= budgetGb).at(-1) ?? OLLAMA_CATALOG[0]
  return { recommended: pick.id, budgetGb }
}

export function fitOf(sizeGb: number, hardware: Pick<HardwareInfo, 'memoryGb' | 'gpuMemoryGb'>, budgetGb: number): OllamaModelOption['fit'] {
  if (sizeGb <= budgetGb) return 'fits'
  return sizeGb <= (hardware.gpuMemoryGb ?? hardware.memoryGb * 0.5) ? 'tight' : 'too-large'
}

let hardwareCache: Promise<HardwareInfo> | null = null
/** Memory and GPU of this machine, detected once. NVIDIA VRAM comes from nvidia-smi when it is installed. */
export function detectHardware(): Promise<HardwareInfo> {
  hardwareCache ??= (async () => {
    const memoryGb = Math.round(totalmem() / 2 ** 30 * 10) / 10, chip = cpus()[0]?.model.trim() ?? 'Unknown processor'
    const unifiedMemory = platform() === 'darwin' && arch() === 'arm64'
    let gpu: string | null = null, gpuMemoryGb: number | null = null
    if (!unifiedMemory) {
      const out = await new Promise<string>((resolve) => execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 2000 }, (error, stdout) => resolve(error ? '' : stdout)))
      const [name, mib] = (out.split('\n')[0] ?? '').split(',').map((part) => part.trim())
      if (name && Number(mib) > 0) { gpu = name; gpuMemoryGb = Math.round(Number(mib) / 1024 * 10) / 10 }
    }
    return { platform: platform(), arch: arch(), chip, memoryGb, unifiedMemory, gpu, gpuMemoryGb }
  })()
  return hardwareCache
}

export interface CompletionDeps {
  /** Pushes progress events to the window. */
  notify?(channel: string, payload: unknown): void
  preferences(): Promise<AppPreferences>
  /** Reads a file inside a task's repository, or null when it does not exist. Used to look up what the current file imports. */
  readFile?(taskId: string, repoId: string, path: string): Promise<string | null>
  /** Finds lines in the task's repository matching a regular expression (ripgrep), nearest-to-useful first. */
  search?(taskId: string, repoId: string, pattern: string): Promise<{ path: string; line: number }[]>
  /** Where the encrypted key is stored. */
  keyFile: string
  crypto: { available(): boolean; encrypt(text: string): Buffer; decrypt(data: Buffer): string }
  ollamaUrl?: string
}

const modelName = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._\-/:]*$/)
const request = z.object({ requestId: z.string().min(1).max(100), taskId: z.string().max(100).default(''), repoId: z.string().max(100).default(''), path: z.string().max(4096), prefix: z.string().max(200_000), suffix: z.string().max(200_000), context: z.array(z.object({ path: z.string().max(4096), content: z.string().max(20_000) })).max(6).default([]) })

const CONTEXT_BUDGET = 5000, CONTEXT_PER_FILE = 1500, MAX_IMPORTS = 4
// Definitions found by searching the whole repository, for code the user has not opened or imported.
const RETRIEVAL_BUDGET = 2200, RETRIEVAL_WAIT_MS = 350, MAX_IDENTIFIERS = 5, SNIPPET_LINES = 10, CACHE_MS = 60_000
const KEYWORDS = new Set(['function', 'return', 'const', 'class', 'import', 'export', 'from', 'this', 'self', 'true', 'false', 'null', 'undefined', 'void', 'async', 'await', 'public', 'private', 'protected', 'static', 'string', 'number', 'boolean', 'interface', 'type', 'extends', 'implements', 'new', 'else', 'while', 'for', 'if', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'default', 'typeof', 'instanceof', 'package', 'struct', 'impl', 'enum', 'None', 'True', 'False', 'def', 'pass', 'print', 'console', 'log', 'length', 'push', 'map', 'filter', 'then', 'resolve', 'reject', 'error', 'value', 'name', 'index', 'items', 'data', 'result', 'props', 'state', 'event', 'args', 'options'])
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|node_modules|dist|build|vendor|fixtures?)(\/|$)|\.(test|spec)\./i

/** Identifiers worth looking up, nearest the cursor first. A partly typed word comes first, since it is what the user is writing. */
export function identifiersAt(prefix: string, suffix: string): { name: string; partial: boolean }[] {
  const tail = prefix.slice(-800), text = `${tail}\n${suffix.slice(0, 300)}`
  const defined = new Set([...text.matchAll(/\b(?:function|class|const|let|var|def|fn|func|type|interface|struct|enum|trait)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]!))
  const found: { name: string; partial: boolean }[] = [], seen = new Set<string>()
  const typing = /([A-Za-z_]\w*)$/.exec(prefix)?.[1]
  if (typing && typing.length >= 3 && !KEYWORDS.has(typing)) { found.push({ name: typing, partial: true }); seen.add(typing) }
  for (const m of [...tail.matchAll(/[A-Za-z_]\w{3,}/g)].reverse()) {
    const name = m[0]
    if (seen.has(name) || defined.has(name) || KEYWORDS.has(name) || name === typing) continue
    seen.add(name); found.push({ name, partial: false })
    if (found.length >= MAX_IDENTIFIERS) break
  }
  return found.slice(0, MAX_IDENTIFIERS)
}

/** Declarations in common languages: functions, classes, types, constants, and methods or properties inside a class. */
export function definitionPattern(name: string, partial: boolean): string {
  const id = partial ? `${name}\\w*` : `${name}\\b`
  return `(?:(?:function|class|interface|type|enum|const|let|var|def|fn|func|struct|trait)\\s+(?:\\([^)]*\\)\\s*)?${id}|^\\s*(?:(?:public|private|protected|static|async|readonly|override|pub)\\s+)*${id}\\s*(?:<[^>]*>)?\\([^)]*\\)\\s*(?::[^{;=]+)?\\{|^\\s*${id}\\s*[:=]\\s*(?:async\\s*)?\\()`
}
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '/index.ts', '/index.tsx', '/index.js']
// Context helps models trained on repository-level prompts; others would read it as part of the file.
const usesFileContext = (model: string) => /qwen.*coder/i.test(model)

/** A short view of another file: all of it when small, otherwise its exported declarations, which is what callers need. */
export function summarize(content: string): string {
  if (content.length <= CONTEXT_PER_FILE) return content.trim()
  const lines = content.split('\n').filter((line) => /^\s*(export\b|(?:async\s+)?function\b|class\b|interface\b|type\b|def\b|pub\b)/.test(line))
  let out = ''
  for (const line of lines) { if (out.length + line.length + 1 > CONTEXT_PER_FILE) break; out += `${line}\n` }
  return (out || content.slice(0, CONTEXT_PER_FILE)).trim()
}

/** Reduces a URL to its origin, and refuses to send a key over plain HTTP except to this machine. */
export function keyHost(url: string): string {
  const parsed = new URL(url)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('The completion endpoint must use https.')
  return parsed.origin
}

const result = (status: CompletionResult['status'], message: string | null = null, text = '', retryAfterMs: number | null = null): CompletionResult => ({ text, status, message, retryAfterMs })

export class CompletionService {
  private inflight = new Map<string, AbortController>()
  private definitions = new Map<string, { at: number; hits: Promise<{ path: string; line: number }[]> }>()
  private pulls = new Map<string, AbortController>()
  private blockedUntil = 0

  constructor(private deps: CompletionDeps) {}

  /** Entry point for the `completion.*` IPC methods. */
  async handle(method: string, args: unknown[]): Promise<unknown> {
    if (method === 'completion.complete') return this.complete(request.parse(args[0]))
    if (method === 'completion.nextEdit') return this.nextEdit(nextEditRequest.parse(args[0]))
    if (method === 'completion.cancel') { this.inflight.get(z.string().parse(args[0]))?.abort(); return }
    if (method === 'completion.status') return this.status()
    if (method === 'completion.pull') return this.pull(modelName.parse(args[0]))
    if (method === 'completion.cancelPull') { this.pulls.get(modelName.parse(args[0]))?.abort(); return }
    if (method === 'completion.setKey') return this.setKey(z.string().min(8).max(500).nullable().parse(args[0]))
    throw new Error('Unknown completion request')
  }

  private ollama() { return this.deps.ollamaUrl ?? 'http://127.0.0.1:11434' }

  private async readKey(host: string): Promise<string | null> {
    try {
      const saved = JSON.parse(await readFile(this.deps.keyFile, 'utf8')) as { host?: string; cipher?: string }
      // A key saved for one host is never released to another.
      if (saved.host !== host || !saved.cipher) return null
      return this.deps.crypto.decrypt(Buffer.from(saved.cipher, 'base64'))
    } catch { return null }
  }

  async setKey(key: string | null): Promise<void> {
    if (key === null) { await rm(this.deps.keyFile, { force: true }); return }
    if (!this.deps.crypto.available()) throw new Error('Secure storage is not available on this system, so the key cannot be saved.')
    const host = keyHost((await this.deps.preferences()).aiCompletion.codestralUrl)
    await writeFile(this.deps.keyFile, JSON.stringify({ host, cipher: this.deps.crypto.encrypt(key).toString('base64') }), { mode: 0o600 })
  }

  async status(): Promise<CompletionStatus> {
    const prefs = (await this.deps.preferences()).aiCompletion, hardware = await detectHardware()
    let host: string | null = null
    try { host = keyHost(prefs.codestralUrl) } catch { /* shown as no key */ }
    const hasKey = !!host && !!(await this.readKey(host))
    let ollama = { running: false, models: [] as string[] }
    try {
      const response = await fetch(`${this.ollama()}/api/tags`, { signal: AbortSignal.timeout(1500) })
      const body = await response.json() as { models?: { name: string }[] }
      ollama = { running: response.ok, models: (body.models ?? []).map((model) => model.name) }
    } catch { /* not running */ }
    const { recommended, budgetGb } = recommendModel(hardware)
    const curated: OllamaModelOption[] = OLLAMA_CATALOG.map((model) => ({ ...model, fit: model.id === recommended ? 'recommended' : fitOf(model.sizeGb, hardware, budgetGb), installed: ollama.models.includes(model.id), curated: true }))
    // Anything else already installed stays selectable, with a reminder that only base models complete code well.
    const extra: OllamaModelOption[] = ollama.models.filter((name) => !OLLAMA_CATALOG.some((model) => model.id === name)).map((name) => ({ id: name, label: name, sizeGb: 0, note: 'Installed. Only base (fill-in-the-middle) models complete code well.', fit: 'fits', installed: true, curated: false }))
    return { hasKey, keyHost: host, ollama, hardware, recommended, options: [...curated, ...extra] }
  }

  /**
   * Predicts the follow-up to the user's latest edits with Codestral. This sends the file being edited to Mistral on every
   * pause, so it also requires the user's explicit acknowledgement in Settings. Local models were tried and rejected: only
   * 7B-class instruct models predicted edits reliably (3B scored 4 of 15 on Ramu's benchmark) and they took seconds each.
   */
  async nextEdit(input: z.infer<typeof nextEditRequest>): Promise<NextEditResult> {
    const prefs = (await this.deps.preferences()).aiCompletion
    const none = (status: NextEditResult['status'], message: string | null = null): NextEditResult => ({ status, edit: null, message })
    if (!prefs.enabled || !prefs.nextEdit) return none('disabled')
    if (prefs.provider !== 'codestral') return none('unavailable', 'Next edit suggestions use Codestral. Choose it as the completion provider.')
    if (!prefs.nextEditAck) return none('unavailable', 'Confirm in Settings that Codestral may receive the file you are editing.')
    if (SENSITIVE.test(input.path)) return none('skipped', 'Files that can hold secrets are not sent to a cloud provider.')
    if (this.blockedUntil > Date.now()) return none('unavailable', 'Rate limited. Suggestions resume shortly.')
    let host: string
    try { host = keyHost(prefs.codestralUrl) } catch (error) { return none('unavailable', error instanceof Error ? error.message : 'Invalid endpoint.') }
    const key = await this.readKey(host)
    if (!key) return none('unavailable', `Add a Codestral API key for ${new URL(host).host} in Settings.`)
    const controller = new AbortController()
    this.inflight.set(input.requestId, controller)
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const edit = await predictNextEdit({ chat: async (system, user, signal) => {
        const response = await fetch(`${host}/v1/chat/completions`, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model: prefs.codestralModel || DEFAULT_CODESTRAL_MODEL, temperature: 0, max_tokens: 400, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
        if (response.status === 429) {
          const wait = Number(response.headers.get('retry-after'))
          this.blockedUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 300) * 1000 : 30_000)
          throw new Error('Rate limited by the provider. Suggestions resume shortly.')
        }
        if (response.status === 401 || response.status === 403) throw new Error('The provider rejected the API key.')
        if (!response.ok) throw new Error(`The provider returned ${response.status}.`)
        const content = ((await response.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content
        return typeof content === 'string' ? content : ''
      } }, { path: input.path, lines: input.lines, cursorLine: input.cursorLine, edits: input.edits }, controller.signal)
      return { status: 'ok', edit, message: null }
    } catch (error) {
      if (controller.signal.aborted) return none('skipped')
      return none('unavailable', error instanceof Error ? error.message : 'Next edit prediction failed.')
    } finally { clearTimeout(timer); this.inflight.delete(input.requestId) }
  }

  /** Downloads a model through Ollama, reporting progress. Only ever started by an explicit click in Settings. */
  async pull(model: string): Promise<void> {
    if (this.pulls.has(model)) return
    const controller = new AbortController()
    this.pulls.set(model, controller)
    const progress = (patch: Partial<PullProgress>) => this.deps.notify?.('completion:pull', { model, status: '', completed: 0, total: 0, done: false, error: null, ...patch })
    try {
      const response = await fetch(`${this.ollama()}/api/pull`, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) })
      if (!response.ok || !response.body) throw new Error(`Ollama returned ${response.status}.`)
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let pending = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1)
          if (!line) continue
          const event = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
          if (event.error) throw new Error(event.error)
          progress({ status: event.status ?? '', completed: event.completed ?? 0, total: event.total ?? 0 })
        }
      }
      progress({ status: 'success', done: true })
    } catch (error) {
      progress({ done: true, error: controller.signal.aborted ? 'Cancelled.' : error instanceof Error && error.name !== 'TypeError' ? error.message : 'Ollama is not running. Start it with `ollama serve`.' })
    } finally { this.pulls.delete(model) }
  }

  async complete(raw: z.input<typeof request>): Promise<CompletionResult> {
    const input = request.parse(raw)
    const prefs = (await this.deps.preferences()).aiCompletion
    if (!prefs.enabled) return result('disabled')
    if (this.blockedUntil > Date.now()) return result('rate-limited', 'Rate limited. Completions resume shortly.', '', this.blockedUntil - Date.now())
    if (prefs.provider === 'codestral' && SENSITIVE.test(input.path)) return result('skipped', 'Files that can hold secrets are not sent to a cloud provider.')
    const prefix = input.prefix.slice(-MAX_PREFIX), suffix = input.suffix.slice(0, MAX_SUFFIX)
    if (!prefix.trim() && !suffix.trim()) return result('skipped')
    const controller = new AbortController()
    this.inflight.set(input.requestId, controller)
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      return prefs.provider === 'ollama' ? await this.viaOllama(prefs.ollamaModel || recommendModel(await detectHardware()).recommended, await this.contextFor(input, prefix, suffix, prefs.ollamaModel || recommendModel(await detectHardware()).recommended), prefix, suffix, controller.signal) : await this.viaCodestral(prefs.codestralUrl, prefs.codestralModel || DEFAULT_CODESTRAL_MODEL, prefix, suffix, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return result('skipped')
      return result('unavailable', error instanceof Error ? error.message : 'Completion failed.')
    } finally { clearTimeout(timer); this.inflight.delete(input.requestId) }
  }

  /**
   * Repository-level context for the local model: the user's other open files, then the files this one imports, each as a
   * `<|file_sep|>path` block ahead of the current file. Local only, so no extra code leaves the machine.
   */
  private async contextFor(input: z.infer<typeof request>, prefix: string, suffix: string, model: string): Promise<string> {
    if (!usesFileContext(model)) return ''
    const blocks: { path: string; text: string }[] = [], seen = new Set([input.path])
    let budget = CONTEXT_BUDGET
    const add = (path: string, content: string) => {
      if (seen.has(path) || budget <= 0 || !content.trim()) return
      const text = summarize(content).slice(0, budget)
      seen.add(path); budget -= text.length; blocks.push({ path, text })
    }
    for (const file of input.context) add(file.path, file.content)
    if (this.deps.readFile && input.taskId && input.repoId) {
      const dir = posix.dirname(input.path.replace(/\\/g, '/')), wanted: string[] = []
      for (const match of `${prefix}\n${suffix}`.matchAll(IMPORT)) if (!wanted.includes(match[1]!)) wanted.push(match[1]!)
      for (const specifier of wanted.slice(0, MAX_IMPORTS)) {
        const base = posix.normalize(posix.join(dir === '.' ? '' : dir, specifier))
        if (base.startsWith('..')) continue
        for (const extension of EXTENSIONS) {
          const candidate = `${base}${extension}`
          if (seen.has(candidate)) break
          const content = await this.deps.readFile(input.taskId, input.repoId, candidate).catch(() => null)
          if (content !== null) { add(candidate, content); break }
        }
      }
    }
    // Definitions elsewhere in the repository come last, closest to the current file, and never delay the suggestion for long.
    const found = await Promise.race([this.retrieve(input, prefix, suffix, seen), new Promise<{ path: string; text: string }[]>((resolve) => setTimeout(() => resolve([]), RETRIEVAL_WAIT_MS))])
    blocks.push(...found)
    return blocks.map((block) => `<|file_sep|>${block.path}\n${block.text}\n`).join('') + (blocks.length ? `<|file_sep|>${input.path}\n` : '')
  }

  private lookup(taskId: string, repoId: string, name: string, partial: boolean): Promise<{ path: string; line: number }[]> {
    const key = `${taskId}\u0000${repoId}\u0000${partial ? '~' : '='}${name}`, cached = this.definitions.get(key)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.hits
    if (this.definitions.size > 400) this.definitions.clear()
    const hits = (this.deps.search?.(taskId, repoId, definitionPattern(name, partial)) ?? Promise.resolve([])).catch(() => [])
    this.definitions.set(key, { at: Date.now(), hits })
    return hits
  }

  /** Short definition snippets for identifiers near the cursor, found by searching the whole repository. */
  private async retrieve(input: z.infer<typeof request>, prefix: string, suffix: string, seen: Set<string>): Promise<{ path: string; text: string }[]> {
    if (!this.deps.search || !this.deps.readFile || !input.taskId || !input.repoId) return []
    const out: { path: string; text: string }[] = []
    let budget = RETRIEVAL_BUDGET
    const lookups = await Promise.all(identifiersAt(prefix, suffix).map(async (id) => ({ id, hits: await this.lookup(input.taskId, input.repoId, id.name, id.partial) })))
    for (const { hits } of lookups) {
      // Source files before tests and build output, and the current file is already in the prompt.
      const others = hits.filter((hit) => hit.path !== input.path), source = others.filter((hit) => !TEST_PATH.test(hit.path))
      const ranked = (source.length ? source : others).sort((a, b) => a.path.length - b.path.length).slice(0, 2)
      for (const hit of ranked) {
        const key = `${hit.path}:${hit.line}`
        if (budget <= 0 || seen.has(key) || seen.has(hit.path)) continue
        const content = await this.deps.readFile(input.taskId, input.repoId, hit.path).catch(() => null)
        if (content === null) continue
        const lines = content.split('\n').slice(hit.line - 1, hit.line - 1 + SNIPPET_LINES)
        const end = lines.findIndex((line, i) => i > 0 && !line.trim())
        const text = (end > 0 ? lines.slice(0, end) : lines).join('\n').slice(0, Math.min(500, budget))
        seen.add(key); budget -= text.length
        out.push({ path: hit.path, text })
      }
    }
    return out.reverse()
  }

  private async viaOllama(model: string, context: string, prefix: string, suffix: string, signal: AbortSignal): Promise<CompletionResult> {
    let response: Response
    try {
      response = await fetch(`${this.ollama()}/api/generate`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt: context + prefix, suffix, stream: false, keep_alive: '30m', options: { num_predict: MAX_TOKENS, temperature: 0, stop: ['<|file_separator|>', '\n\n\n'] } }) })
    } catch (error) {
      if (signal.aborted) throw error
      return result('unavailable', 'Ollama is not running. Start it with `ollama serve`.')
    }
    if (response.status === 404) return result('unavailable', `Model ${model} is not installed. Run: ollama pull ${model}`)
    if (!response.ok) return result('unavailable', `Ollama returned ${response.status}.`)
    const body = await response.json() as { response?: unknown }
    return typeof body.response === 'string' ? result('ok', null, body.response.trimEnd()) : result('unavailable', 'Ollama returned no text.')
  }

  private async viaCodestral(url: string, model: string, prefix: string, suffix: string, signal: AbortSignal): Promise<CompletionResult> {
    const host = keyHost(url), key = await this.readKey(host)
    if (!key) return result('no-key', `Add a Codestral API key for ${new URL(host).host} in Settings.`)
    const response = await fetch(`${host}/v1/fim/completions`, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, prompt: prefix, suffix, max_tokens: MAX_TOKENS, temperature: 0, stream: false }) })
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after'))
      const ms = Number.isFinite(wait) && wait > 0 ? Math.min(wait, 300) * 1000 : 30_000
      this.blockedUntil = Date.now() + ms
      return result('rate-limited', 'Rate limited by the provider. Completions resume shortly.', '', ms)
    }
    if (response.status === 401 || response.status === 403) return result('no-key', 'The provider rejected the API key.')
    if (!response.ok) return result('unavailable', `The provider returned ${response.status}.`)
    const body = await response.json() as { choices?: { message?: { content?: unknown } }[] }
    const text = body.choices?.[0]?.message?.content
    return typeof text === 'string' ? result('ok', null, text.trimEnd()) : result('unavailable', 'The provider returned no text.')
  }
}
