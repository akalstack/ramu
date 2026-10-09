// Language servers for the editor: completion, hover, go to definition, signature help and type diagnostics.
// One server runs per (repository folder, language); documents are reference counted because the same file can
// be open in several chats, and servers are shut down when nothing needs them. The service outlives the window,
// so it releases documents when the last window disconnects.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Connection, RpcError } from './jsonrpc'
import type { LspCompletionItem, LspCompletionList, LspDiagnostic, LspHover, LspRange, LspSignatureHelp } from '../shared/types'

export interface ServerSpec { command: string; args: string[]; cwd: string; initializationOptions?: unknown; env?: Record<string, string> }
export interface LspAdapter {
  id: string
  label: string
  matches(file: string): boolean
  languageId(file: string): string
  /** Null when the project has no usable server for this file. */
  resolve(cwd: string, file: string): ServerSpec | null
}

interface Doc { text: string; version: number; owners: Set<string> }
interface Handle {
  key: string; adapter: LspAdapter; cwd: string; spec: ServerSpec
  conn: Connection | null; ready: Promise<void> | null
  docs: Map<string, Doc>
  crashes: number[]; stopping: boolean; failed: string | null
  idleTimer?: NodeJS.Timeout; lastUse: number
  /** Servers such as TypeScript 7 expect clients to ask for diagnostics instead of pushing them. */
  pull: boolean; pullTimer?: NodeJS.Timeout
}

export interface LspOptions { idleMs?: number; maxServers?: number; restartDelayMs?: number; adapters?: LspAdapter[] }
type Emit = (channel: string, payload: unknown) => void
interface RawDiagnostic { severity?: number; message: string; code?: string | number; source?: string; range: Parameters<typeof range>[0] }

const range = (r: { start: { line: number; character: number }; end: { line: number; character: number } }): LspRange => ({ startLine: r.start.line + 1, startColumn: r.start.character + 1, endLine: r.end.line + 1, endColumn: r.end.character + 1 })

const markdown = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const v = value as { kind?: string; value?: string; language?: string }
    if (typeof v.value === 'string') return v.language ? '```' + v.language + '\n' + v.value + '\n```' : v.value
  }
  return null
}

// LSP and Monaco number completion kinds differently, so this is an explicit table (LSP kind -> Monaco CompletionItemKind).
const KIND: Record<number, number> = { 1: 18, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 7, 9: 8, 10: 9, 11: 12, 12: 13, 13: 15, 14: 17, 15: 27, 16: 19, 17: 20, 18: 21, 19: 23, 20: 16, 21: 14, 22: 6, 23: 10, 24: 11, 25: 24 }

function walkUp(from: string, to: string): string[] {
  const dirs: string[] = []
  for (let dir = from; ; dir = dirname(dir)) {
    const rel = relative(to, dir)
    if (rel.startsWith('..') || isAbsolute(rel)) break
    dirs.push(dir)
    if (dir === to || dirname(dir) === dir) break
  }
  return dirs
}
const readJson = (path: string): Record<string, any> | null => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }

/** Finds one of Ramu's own packages by walking up from this file, which works in development and unpacked releases. */
function ownPackage(name: string): string | null {
  for (let dir = import.meta.dirname; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return join(dir, 'node_modules', name)
    if (dirname(dir) === dir) return null
  }
}

const TS_LANGUAGES: Record<string, string> = { ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescriptreact', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascriptreact' }

/**
 * TypeScript 7 ships a native compiler that is itself a language server. Older projects use typescript-language-server
 * (bundled with Ramu) driving the project's own tsserver, so type errors match what the project's compiler reports.
 */
export const typescriptAdapter: LspAdapter = {
  id: 'typescript', label: 'TypeScript',
  matches: (file) => extname(file).slice(1).toLowerCase() in TS_LANGUAGES,
  languageId: (file) => TS_LANGUAGES[extname(file).slice(1).toLowerCase()] ?? 'typescript',
  resolve(cwd, file) {
    let projectServer: string | null = null
    for (const dir of walkUp(dirname(file), cwd)) {
      const pkgDir = join(dir, 'node_modules', 'typescript'), manifest = readJson(join(pkgDir, 'package.json'))
      if (!manifest) continue
      const major = Number(String(manifest.version).split('.')[0])
      if (major >= 7) {
        const exe = process.platform === 'win32' ? 'tsc.exe' : 'tsc', platform = `typescript-${process.platform}-${process.arch}`
        const native = [join(dir, 'node_modules', '@typescript', platform, 'lib', exe), join(pkgDir, 'node_modules', '@typescript', platform, 'lib', exe)].find((path) => existsSync(path))
        if (native) return { command: native, args: ['--lsp', '--stdio'], cwd }
      } else if (existsSync(join(pkgDir, 'lib', 'tsserver.js'))) projectServer = join(pkgDir, 'lib', 'tsserver.js')
      break
    }
    const server = ownPackage('typescript-language-server'), bundled = ownPackage('typescript')
    const tsserver = projectServer ?? (bundled ? join(bundled, 'lib', 'tsserver.js') : null)
    const bin = server && (readJson(join(server, 'package.json'))?.bin?.['typescript-language-server'] as string | undefined)
    if (!server || !bin || !tsserver || !existsSync(tsserver)) return null
    return { command: process.execPath, args: [join(server, bin), '--stdio'], cwd, env: { ELECTRON_RUN_AS_NODE: '1' }, initializationOptions: { tsserver: { path: tsserver }, preferences: { includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true } } }
  },
}

export class LspService {
  private handles = new Map<string, Handle>()
  private byDoc = new Map<string, Handle>()
  private requests = new Map<string, AbortController>()
  private adapters: LspAdapter[]
  private idleMs: number; private maxServers: number; private restartDelayMs: number

  constructor(private emit: Emit, options: LspOptions = {}) {
    this.adapters = options.adapters ?? [typescriptAdapter]
    this.idleMs = options.idleMs ?? 180_000; this.maxServers = options.maxServers ?? 6; this.restartDelayMs = options.restartDelayMs ?? 500
  }

  /** Which server (if any) handles this file, without starting it. */
  serverFor(cwd: string, file: string): { adapter: LspAdapter; spec: ServerSpec } | null {
    for (const adapter of this.adapters) {
      if (!adapter.matches(file)) continue
      const spec = adapter.resolve(cwd, file)
      if (spec) return { adapter, spec }
    }
    return null
  }

  async open(owner: string, cwd: string, file: string, text: string): Promise<{ server: string | null }> {
    const existing = this.byDoc.get(file)
    let handle = existing
    if (!handle) {
      const found = this.serverFor(cwd, file)
      if (!found) return { server: null }
      handle = this.handleFor(cwd, found.adapter, found.spec)
    }
    if (handle.failed) return { server: null }
    clearTimeout(handle.idleTimer); handle.lastUse = Date.now()
    let doc = handle.docs.get(file)
    this.byDoc.set(file, handle)
    if (!doc) {
      doc = { text, version: 1, owners: new Set([owner]) }; handle.docs.set(file, doc)
      try { await this.start(handle) } catch { return { server: null } }
      handle.conn?.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: handle.adapter.languageId(file), version: 1, text } })
      this.schedulePull(handle)
    } else {
      doc.owners.add(owner)
      if (doc.text !== text) this.change(file, text)
    }
    return { server: handle.adapter.label }
  }

  change(file: string, text: string) {
    const handle = this.byDoc.get(file), doc = handle?.docs.get(file)
    if (!handle || !doc || doc.text === text) return
    doc.text = text; doc.version++
    handle.conn?.notify('textDocument/didChange', { textDocument: { uri: pathToFileURL(file).href, version: doc.version }, contentChanges: [{ text }] })
    this.schedulePull(handle)
  }

  close(owner: string, file: string) {
    const handle = this.byDoc.get(file), doc = handle?.docs.get(file)
    if (!handle || !doc) return
    doc.owners.delete(owner)
    if (doc.owners.size) return
    handle.docs.delete(file); this.byDoc.delete(file)
    handle.conn?.notify('textDocument/didClose', { textDocument: { uri: pathToFileURL(file).href } })
    this.emit('lsp:diagnostics', { cwd: handle.cwd, path: relative(handle.cwd, file), diagnostics: [] })
    if (!handle.docs.size) handle.idleTimer = setTimeout(() => void this.shutdown(handle), this.idleMs)
  }

  /** Called when the last window disconnects, so closed windows do not leave servers working. */
  releaseAll() {
    for (const handle of this.handles.values()) {
      for (const [file, doc] of [...handle.docs]) for (const owner of [...doc.owners]) this.close(owner, file)
    }
  }

  cancel(requestId: string) { this.requests.get(requestId)?.abort() }

  async stop() {
    this.releaseAll()
    await Promise.all([...this.handles.values()].map((handle) => this.shutdown(handle)))
  }

  private handleFor(cwd: string, adapter: LspAdapter, spec: ServerSpec): Handle {
    const key = `${cwd}\u0000${adapter.id}`
    let handle = this.handles.get(key)
    if (handle) return handle
    if (this.handles.size >= this.maxServers) {
      const idle = [...this.handles.values()].filter((h) => !h.docs.size).sort((a, b) => a.lastUse - b.lastUse)[0]
      if (!idle) throw new Error('Too many language servers are running.')
      void this.shutdown(idle)
    }
    handle = { key, adapter, cwd, spec, conn: null, ready: null, docs: new Map(), crashes: [], stopping: false, failed: null, lastUse: Date.now(), pull: false }
    this.handles.set(key, handle)
    return handle
  }

  private start(handle: Handle): Promise<void> {
    if (handle.ready) return handle.ready
    handle.ready = (async () => {
      const child = spawn(handle.spec.command, handle.spec.args, { cwd: handle.spec.cwd, env: { ...process.env, ...handle.spec.env }, stdio: ['pipe', 'pipe', 'pipe'] })
      child.stderr.on('data', () => {})
      const conn = new Connection(child)
      handle.conn = conn
      conn.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: RawDiagnostic[] }) => {
        let file: string
        try { file = fileURLToPath(params.uri) } catch { return }
        this.publish(handle, file, params.diagnostics)
      })
      conn.onRequest('workspace/configuration', (params: { items: unknown[] }) => params.items.map(() => null))
      conn.onRequest('workspace/diagnostic/refresh', () => { this.schedulePull(handle); return null })
      conn.onClose = () => this.exited(handle)
      const root = pathToFileURL(handle.cwd).href
      const init = await conn.request<{ capabilities?: { diagnosticProvider?: unknown } }>('initialize', { processId: process.pid, clientInfo: { name: 'Ramu' }, rootUri: root, workspaceFolders: [{ uri: root, name: 'workspace' }], initializationOptions: handle.spec.initializationOptions, capabilities: {
        general: { positionEncodings: ['utf-16'] },
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: { synchronization: { didSave: false }, publishDiagnostics: { relatedInformation: false }, diagnostic: { dynamicRegistration: false }, completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }, labelDetailsSupport: true, deprecatedSupport: true } }, hover: { contentFormat: ['markdown', 'plaintext'] }, signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } }, definition: { linkSupport: true } },
      } }, { timeoutMs: 30_000 })
      handle.pull = !!init?.capabilities?.diagnosticProvider
      conn.notify('initialized', {})
      this.emit('lsp:status', { cwd: handle.cwd, server: handle.adapter.id, label: handle.adapter.label, state: 'ready', message: null })
    })().catch((error) => { handle.ready = null; handle.conn?.dispose(); handle.conn = null; throw error })
    return handle.ready
  }

  private publish(handle: Handle, file: string, raw: RawDiagnostic[]) {
    if (!handle.docs.has(file)) return
    const diagnostics: LspDiagnostic[] = raw.map((d) => ({ severity: (['error', 'error', 'warning', 'info', 'hint'] as const)[d.severity ?? 1] ?? 'error', message: d.message, code: d.code === undefined ? null : String(d.code), source: d.source ?? handle.adapter.label, range: range(d.range) }))
    this.emit('lsp:diagnostics', { cwd: handle.cwd, path: relative(handle.cwd, file), diagnostics })
  }

  /** Asks for diagnostics shortly after edits settle. A change can affect other open files, so all of them are refreshed. */
  private schedulePull(handle: Handle) {
    if (!handle.pull) return
    clearTimeout(handle.pullTimer)
    handle.pullTimer = setTimeout(() => {
      const conn = handle.conn
      if (!conn) return
      for (const file of [...handle.docs.keys()].slice(0, 20)) {
        conn.request<{ kind?: string; items?: RawDiagnostic[] }>('textDocument/diagnostic', { textDocument: { uri: pathToFileURL(file).href } }).then((report) => { if (report?.kind === 'full' && report.items) this.publish(handle, file, report.items) }, () => {})
      }
    }, 250)
  }

  private exited(handle: Handle) {
    handle.conn = null; handle.ready = null
    if (handle.stopping) { this.handles.delete(handle.key); return }
    const now = Date.now()
    handle.crashes = [...handle.crashes.filter((t) => now - t < 60_000), now]
    if (handle.crashes.length > 3 || !handle.docs.size) {
      if (handle.docs.size) {
        handle.failed = 'The language server keeps stopping.'
        this.emit('lsp:status', { cwd: handle.cwd, server: handle.adapter.id, label: handle.adapter.label, state: 'failed', message: handle.failed })
      } else this.handles.delete(handle.key)
      return
    }
    // Restart and replay every open document so the editor keeps working without the user noticing.
    setTimeout(() => {
      if (handle.stopping || handle.failed) return
      void this.start(handle).then(() => {
        for (const [file, doc] of handle.docs) handle.conn?.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: handle.adapter.languageId(file), version: ++doc.version, text: doc.text } })
        this.schedulePull(handle)
      }, () => { handle.failed = 'The language server could not be restarted.'; this.emit('lsp:status', { cwd: handle.cwd, server: handle.adapter.id, label: handle.adapter.label, state: 'failed', message: handle.failed }) })
    }, this.restartDelayMs * 2 ** (handle.crashes.length - 1))
  }

  private async shutdown(handle: Handle) {
    clearTimeout(handle.idleTimer); clearTimeout(handle.pullTimer)
    if (handle.docs.size) return
    handle.stopping = true
    const conn = handle.conn
    this.handles.delete(handle.key)
    if (!conn) return
    try { await conn.request('shutdown', undefined, { timeoutMs: 1500 }); conn.notify('exit') } catch { /* killed below */ }
    setTimeout(() => conn.dispose(), 500).unref()
  }

  private async call<T>(file: string, requestId: string, method: string, params: Record<string, unknown>): Promise<T | null> {
    const handle = this.byDoc.get(file)
    if (!handle || handle.failed) return null
    try { await this.start(handle) } catch { return null }
    const conn = handle.conn
    if (!conn) return null
    handle.lastUse = Date.now()
    const controller = new AbortController()
    this.requests.set(requestId, controller)
    try { return await conn.request<T>(method, { textDocument: { uri: pathToFileURL(file).href }, ...params }, { signal: controller.signal }) }
    catch (error) {
      if (error instanceof RpcError) return null
      throw error
    } finally { this.requests.delete(requestId) }
  }

  async completion(file: string, requestId: string, line: number, column: number, trigger: string | null): Promise<LspCompletionList> {
    const result = await this.call<unknown[] | { isIncomplete?: boolean; items: any[] }>(file, requestId, 'textDocument/completion', { position: { line: line - 1, character: column - 1 }, context: trigger ? { triggerKind: 2, triggerCharacter: trigger } : { triggerKind: 1 } })
    if (!result) return { incomplete: false, items: [] }
    const list = Array.isArray(result) ? { isIncomplete: false, items: result } : result
    const items: LspCompletionItem[] = list.items.slice(0, 1500).map((item) => {
      const edit = item.textEdit
      const editRange = edit ? ('range' in edit ? edit.range : edit.insert) : null
      return {
        label: String(item.label), labelDetail: item.labelDetails?.detail ?? null, kind: KIND[item.kind] ?? 18, detail: item.detail ?? null, documentation: markdown(item.documentation),
        insertText: edit?.newText ?? item.insertText ?? String(item.label), snippet: item.insertTextFormat === 2,
        range: editRange ? range(editRange) : null, sortText: item.sortText ?? null, filterText: item.filterText ?? null, commitCharacters: item.commitCharacters ?? [], deprecated: !!item.deprecated || !!item.tags?.includes(1), raw: item,
      }
    })
    return { incomplete: !!list.isIncomplete, items }
  }

  async resolve(file: string, requestId: string, raw: unknown): Promise<{ detail: string | null; documentation: string | null; additionalEdits: { range: LspRange; text: string }[] } | null> {
    const handle = this.byDoc.get(file)
    if (!handle?.conn) return null
    const controller = new AbortController(); this.requests.set(requestId, controller)
    try {
      const item = await handle.conn.request<any>('completionItem/resolve', raw, { signal: controller.signal })
      return { detail: item?.detail ?? null, documentation: markdown(item?.documentation), additionalEdits: (item?.additionalTextEdits ?? []).map((e: { range: Parameters<typeof range>[0]; newText: string }) => ({ range: range(e.range), text: e.newText })) }
    } catch (error) { if (error instanceof RpcError) return null; throw error } finally { this.requests.delete(requestId) }
  }

  async hover(file: string, requestId: string, line: number, column: number): Promise<LspHover | null> {
    const result = await this.call<{ contents: unknown; range?: Parameters<typeof range>[0] }>(file, requestId, 'textDocument/hover', { position: { line: line - 1, character: column - 1 } })
    if (!result?.contents) return null
    const parts = (Array.isArray(result.contents) ? result.contents : [result.contents]).map(markdown).filter((part): part is string => !!part && part.trim() !== '')
    return parts.length ? { contents: parts, range: result.range ? range(result.range) : null } : null
  }

  async definition(file: string, requestId: string, line: number, column: number): Promise<{ file: string; range: LspRange }[]> {
    const result = await this.call<any>(file, requestId, 'textDocument/definition', { position: { line: line - 1, character: column - 1 } })
    if (!result) return []
    const found: { file: string; range: LspRange }[] = []
    for (const entry of Array.isArray(result) ? result : [result]) {
      const uri = entry.targetUri ?? entry.uri, target = entry.targetSelectionRange ?? entry.targetRange ?? entry.range
      if (!uri || !target) continue
      try { found.push({ file: fileURLToPath(uri), range: range(target) }) } catch { /* not a file */ }
    }
    return found
  }

  async signature(file: string, requestId: string, line: number, column: number, trigger: string | null): Promise<LspSignatureHelp | null> {
    const result = await this.call<any>(file, requestId, 'textDocument/signatureHelp', { position: { line: line - 1, character: column - 1 }, context: { triggerKind: trigger ? 2 : 1, triggerCharacter: trigger ?? undefined, isRetrigger: false } })
    if (!result?.signatures?.length) return null
    return { activeSignature: result.activeSignature ?? 0, activeParameter: result.activeParameter ?? 0, signatures: result.signatures.map((s: any) => ({ label: s.label, documentation: markdown(s.documentation), parameters: (s.parameters ?? []).map((p: any) => ({ label: p.label, documentation: markdown(p.documentation) })) })) }
  }
}
