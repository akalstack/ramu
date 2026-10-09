// Bridges language servers (running in the background service) to Monaco: completion, hover, go to definition,
// signature help and diagnostics. When servers are on, Monaco's built-in TypeScript worker is switched off for
// those features so results are not duplicated; it stays on for formatting and as a fallback if servers fail.
import type { LspDiagnostics, LspRange } from '../../shared/types'
import { invoke, ramu } from './ipc'
import { monaco } from './monaco'

interface Meta { taskId: string; repoId: string; path: string; cwd: string }
interface Doc { meta: Meta; model: monaco.editor.ITextModel; opened: boolean; timer?: ReturnType<typeof setTimeout>; sent: string | null; sending: Promise<void> | null }

const docs = new Map<string, Doc>()
let enabled = true
let failed = false
let counter = 0
let lastCompletionDoc: Doc | null = null
let openFile: ((taskId: string, repoId: string, path: string, selection: { line: number; column: number; endColumn: number }) => void) | null = null

const TS_DEFAULTS = () => [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]
/** Monaco's own TypeScript features, minus formatting, which Ramu's Format Document command still falls back to. */
function applyBuiltins() {
  const own = !(enabled && !failed)
  for (const defaults of TS_DEFAULTS()) defaults.setModeConfiguration({ completionItems: own, hovers: own, documentSymbols: true, definitions: own, references: own, documentHighlights: true, rename: own, diagnostics: own, documentRangeFormattingEdits: true, signatureHelp: own, onTypeFormattingEdits: true, codeActions: own, inlayHints: own })
}

export function setLanguageServersEnabled(value: boolean) { enabled = value; applyBuiltins() }
/** Where "go to definition" opens files outside the current editor; provided by the workspace UI. */
export function setFileOpener(handler: typeof openFile) { openFile = handler }

const rangeOf = (r: LspRange) => new monaco.Range(r.startLine, r.startColumn, r.endLine, r.endColumn)
const active = (model: monaco.editor.ITextModel): Doc | null => { const doc = docs.get(model.uri.toString()); return enabled && !failed && doc?.opened ? doc : null }

async function flush(doc: Doc): Promise<void> {
  clearTimeout(doc.timer)
  await doc.sending
  const text = doc.model.getValue()
  if (!doc.opened || text === doc.sent) return
  doc.sent = text
  doc.sending = invoke('lsp.change', doc.meta.taskId, doc.meta.repoId, doc.meta.path, text).catch(() => {}).finally(() => { doc.sending = null })
  await doc.sending
}

/**
 * Starts syncing a loaded model with its language server. Returns a disposer. Edits are sent after a short pause,
 * and always flushed before a request so the server answers about the text on screen.
 */
export function openLspDocument(model: monaco.editor.ITextModel, meta: Meta): () => void {
  const key = model.uri.toString()
  const doc: Doc = { meta, model, opened: false, sent: null, sending: null }
  docs.set(key, doc)
  const text = model.getValue()
  void invoke('lsp.open', meta.taskId, meta.repoId, meta.path, text).then((result) => {
    // Only mark open if the file has a server and this document is still the current one.
    if (docs.get(key) === doc && result.server) { doc.opened = true; doc.sent = text; void flush(doc) }
  }, () => {})
  const sub = model.onDidChangeContent(() => { if (!doc.opened) return; clearTimeout(doc.timer); doc.timer = setTimeout(() => void flush(doc), 120) })
  return () => {
    sub.dispose(); clearTimeout(doc.timer)
    monaco.editor.setModelMarkers(model, 'ramu-lsp', [])
    if (docs.get(key) === doc) docs.delete(key)
    if (doc.opened) void invoke('lsp.close', meta.taskId, meta.repoId, meta.path).catch(() => {})
  }
}

const requestId = (token: monaco.CancellationToken) => { const id = `lsp-${++counter}`; token.onCancellationRequested(() => { void invoke('lsp.cancel', id).catch(() => {}) }); return id }
const LANGUAGES = ['typescript', 'javascript']

for (const language of LANGUAGES) {
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', '"', "'", '`', '/', '@', '<', '#'],
    async provideCompletionItems(model, position, context, token) {
      const doc = active(model)
      if (!doc) return { suggestions: [] }
      await flush(doc)
      if (token.isCancellationRequested) return { suggestions: [] }
      lastCompletionDoc = doc
      const list = await invoke('lsp.completion', requestId(token), doc.meta.taskId, doc.meta.repoId, doc.meta.path, position.lineNumber, position.column, context.triggerCharacter ?? null).catch(() => null)
      if (!list || token.isCancellationRequested) return { suggestions: [] }
      const word = model.getWordUntilPosition(position), fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      return {
        incomplete: list.incomplete,
        suggestions: list.items.map((item) => ({
          label: item.labelDetail ? { label: item.label, detail: item.labelDetail } : item.label, kind: item.kind,
          detail: item.detail ?? undefined, documentation: item.documentation ? { value: item.documentation } : undefined,
          insertText: item.insertText, insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range: item.range ? rangeOf(item.range) : fallback, sortText: item.sortText ?? undefined, filterText: item.filterText ?? undefined,
          commitCharacters: item.commitCharacters.length ? item.commitCharacters : undefined, tags: item.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
          // Handed back untouched when the user highlights an item, so the server can add documentation and auto-imports.
          _raw: item.raw,
        } as monaco.languages.CompletionItem)),
      }
    },
    async resolveCompletionItem(item) {
      const doc = lastCompletionDoc, raw = (item as { _raw?: unknown })._raw
      if (!doc || raw === undefined) return item
      // Not cancelled with the token: Monaco cancels it when the widget closes on accept, and the import edit would be lost.
      const detail = await invoke('lsp.resolve', `lsp-resolve-${++counter}`, doc.meta.taskId, doc.meta.repoId, doc.meta.path, raw).catch(() => null)
      if (!detail) return item
      return { ...item, detail: detail.detail ?? item.detail, documentation: detail.documentation ? { value: detail.documentation } : item.documentation, additionalTextEdits: detail.additionalEdits.map((edit) => ({ range: rangeOf(edit.range), text: edit.text })) }
    },
  })

  monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position, token) {
      const doc = active(model)
      if (!doc) return null
      await flush(doc)
      const hover = await invoke('lsp.hover', requestId(token), doc.meta.taskId, doc.meta.repoId, doc.meta.path, position.lineNumber, position.column).catch(() => null)
      return hover ? { range: hover.range ? rangeOf(hover.range) : undefined, contents: hover.contents.map((value) => ({ value })) } : null
    },
  })

  monaco.languages.registerDefinitionProvider(language, {
    async provideDefinition(model, position, token) {
      const doc = active(model)
      if (!doc) return null
      await flush(doc)
      const found = await invoke('lsp.definition', requestId(token), doc.meta.taskId, doc.meta.repoId, doc.meta.path, position.lineNumber, position.column).catch(() => [])
      return found.map((hit) => ({ uri: monaco.Uri.from({ scheme: 'file', path: `/${doc.meta.taskId}/${hit.repoId}/${hit.path}` }), range: rangeOf(hit.range) }))
    },
  })

  monaco.languages.registerSignatureHelpProvider(language, {
    signatureHelpTriggerCharacters: ['(', ',', '<'], signatureHelpRetriggerCharacters: [')'],
    async provideSignatureHelp(model, position, token, context) {
      const doc = active(model)
      if (!doc) return null
      await flush(doc)
      const help = await invoke('lsp.signature', requestId(token), doc.meta.taskId, doc.meta.repoId, doc.meta.path, position.lineNumber, position.column, context.triggerCharacter ?? null).catch(() => null)
      if (!help) return null
      return { dispose() {}, value: { activeSignature: help.activeSignature, activeParameter: help.activeParameter, signatures: help.signatures.map((s) => ({ label: s.label, documentation: s.documentation ? { value: s.documentation } : undefined, parameters: s.parameters.map((p) => ({ label: p.label, documentation: p.documentation ? { value: p.documentation } : undefined })) })) } }
    },
  })
}

// Go to definition in another file asks the workspace to open it (as a tab) instead of a hidden model.
monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selection) {
    const [, taskId, repoId, ...rest] = resource.path.split('/')
    if (resource.scheme !== 'file' || !taskId || !repoId || !rest.length || !openFile) return false
    const position = selection && 'startLineNumber' in selection ? { line: selection.startLineNumber, column: selection.startColumn, endColumn: selection.endColumn } : selection ? { line: selection.lineNumber, column: selection.column, endColumn: selection.column } : { line: 1, column: 1, endColumn: 1 }
    // Opening the file the user is already in is left to Monaco.
    for (const doc of docs.values()) if (doc.model.uri.toString() === resource.toString()) return false
    openFile(taskId, repoId, rest.join('/'), position)
    return true
  },
})

const SEVERITY = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info, hint: monaco.MarkerSeverity.Hint }
ramu.on('lsp:diagnostics', ({ cwd, path, diagnostics }: LspDiagnostics) => {
  for (const doc of docs.values()) {
    if (doc.meta.cwd !== cwd || doc.meta.path !== path) continue
    monaco.editor.setModelMarkers(doc.model, 'ramu-lsp', diagnostics.map((d) => ({ severity: SEVERITY[d.severity], message: d.message, source: d.source ?? undefined, code: d.code ?? undefined, startLineNumber: d.range.startLine, startColumn: d.range.startColumn, endLineNumber: d.range.endLine, endColumn: d.range.endColumn })))
  }
})
// If a server cannot stay up, hand completion and diagnostics back to Monaco rather than leave the editor bare.
ramu.on('lsp:status', (status) => { failed = status.state === 'failed' ? true : failed; applyBuiltins() })
