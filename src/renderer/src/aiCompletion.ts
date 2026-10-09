// Inline (ghost text) AI completion. The provider is registered once for every editor; requests go to the
// main process, which owns the provider configuration and API key.
import { invoke } from './ipc'
import { monaco } from './monaco'

let enabled = false
let nextEditEnabled = false
let counter = 0
export const setAiCompletionEnabled = (value: boolean) => { enabled = value }
export const setNextEditEnabled = (value: boolean) => { nextEditEnabled = value }

// --- Next edit prediction: what the user just changed, and the follow-up edit predicted from it. ---
interface Burst { line: number; before: string[]; after: string[]; at: number }
interface Predicted { version: number; edit: { startLine: number; endLine: number; text: string } }
interface Track { lines: string[]; bursts: Burst[]; timer?: ReturnType<typeof setTimeout>; ready: Predicted | null; version: number }
const tracks = new Map<string, Track>()
const editors = new Map<string, monaco.editor.ICodeEditor>()
const predictionReady = new monaco.Emitter<void>()
const MAX_BURST_LINES = 30, EDIT_MEMORY_MS = 3 * 60_000, MAX_TRACKED_LINES = 5000

/** The lines that differ between two versions of a file, as one edit: what the user changed in a burst of typing. */
export function diffLines(before: string[], after: string[]): Omit<Burst, 'at'> | null {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let endBefore = before.length, endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter-- }
  if (start === endBefore && start === endAfter) return null
  return { line: start + 1, before: before.slice(start, endBefore), after: after.slice(start, endAfter) }
}

function track(model: monaco.editor.ITextModel) {
  if (model.uri.scheme !== 'file' || model.isDisposed()) return
  const key = model.uri.toString(), t: Track = { lines: model.getLinesContent(), bursts: [], ready: null, version: model.getVersionId() }
  tracks.set(key, t)
  model.onDidChangeContent(() => {
    t.ready = null
    clearTimeout(t.timer)
    // A pause ends the burst: record what changed, then ask what the user is likely to change next.
    t.timer = setTimeout(() => {
      const now = model.getLinesContent(), change = diffLines(t.lines, now)
      t.lines = now
      // A whole-file load, a paste or a refactor is not an edit worth predicting from.
      if (!change || change.before.length > MAX_BURST_LINES || change.after.length > MAX_BURST_LINES) return
      t.bursts = [...t.bursts.filter((b) => Date.now() - b.at < EDIT_MEMORY_MS), { ...change, at: Date.now() }].slice(-6)
      void predictNext(model, t)
    }, 450)
  })
  model.onWillDispose(() => { clearTimeout(t.timer); tracks.delete(key); editors.delete(key) })
}
monaco.editor.getModels().forEach(track)
monaco.editor.onDidCreateModel(track)

let lastEditMessage: string | null = null
async function predictNext(model: monaco.editor.ITextModel, t: Track) {
  if (!enabled || !nextEditEnabled || model.getLineCount() > MAX_TRACKED_LINES) return
  const version = model.getVersionId(), requestId = `edit-${++counter}`
  const cursor = editors.get(model.uri.toString())?.getPosition()?.lineNumber ?? t.bursts.at(-1)!.line
  const path = model.uri.path.split('/').slice(3).join('/')
  let result
  try { result = await invoke('completion.nextEdit', { requestId, path, lines: model.getLinesContent(), cursorLine: cursor, edits: t.bursts.map(({ line, before, after }) => ({ line, before, after })) }) } catch { return }
  if (result.status === 'unavailable' && result.message !== lastEditMessage) { lastEditMessage = result.message; announce(result.message) }
  // Drop answers about text that has since changed.
  if (result.status !== 'ok' || !result.edit || model.getVersionId() !== version) return
  t.ready = { version, edit: result.edit }
  predictionReady.fire()
  // The change event alone does not make Monaco ask again, so ask it to.
  const editor = editors.get(model.uri.toString())
  if (editor?.getModel() === model && editor.hasTextFocus()) editor.trigger('ramu', 'editor.action.inlineSuggest.trigger', {})
}

monaco.editor.onDidCreateEditor((editor) => {
  const remember = () => { const uri = editor.getModel()?.uri.toString(); if (uri) editors.set(uri, editor) }
  remember(); editor.onDidChangeModel(remember)
})

/** When each file was last used, so the model sees the files the user has been working in. */
const touched = new Map<string, number>()
monaco.editor.onDidCreateEditor((editor) => { editor.onDidFocusEditorText(() => { const uri = editor.getModel()?.uri.toString(); if (uri) touched.set(uri, Date.now()) }) })

/** The user's other open files in the same task, most recently used first. */
function openFiles(current: monaco.editor.ITextModel, taskId: string) {
  return monaco.editor.getModels()
    .filter((model) => model !== current && model.uri.scheme === 'file' && model.uri.path.startsWith(`/${taskId}/`))
    .sort((a, b) => (touched.get(b.uri.toString()) ?? 0) - (touched.get(a.uri.toString()) ?? 0))
    .slice(0, 4)
    .map((model) => ({ path: model.uri.path.split('/').slice(3).join('/'), content: model.getValue().slice(0, 20_000) }))
}

/** One short line in the editor header explains why suggestions are paused. */
const announce = (message: string | null) => window.dispatchEvent(new CustomEvent('ramu:completion-status', { detail: message }))

monaco.languages.registerInlineCompletionsProvider('*', {
  // Wait for a pause in typing, so a burst of keystrokes makes one request.
  debounceDelayMs: 300,
  // Fired when a next-edit prediction arrives, so Monaco asks again and shows it.
  onDidChangeInlineCompletions: predictionReady.event,
  async provideInlineCompletions(model, position, _context, token) {
    // Only files opened from a project; the conflict-comparison and other scratch models have no file URI.
    if (!enabled || model.uri.scheme !== 'file') return { items: [] }
    // A predicted follow-up edit wins over a completion at the cursor: it is what Tab should do next.
    const ready = tracks.get(model.uri.toString())?.ready
    if (nextEditEnabled && ready && ready.version === model.getVersionId()) {
      const { startLine, endLine, text } = ready.edit
      return { items: [{ insertText: text, range: new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)), isInlineEdit: true, showInlineEditMenu: true }] }
    }
    const requestId = `completion-${++counter}`
    token.onCancellationRequested(() => { void invoke('completion.cancel', requestId).catch(() => {}) })
    const last = model.getLineCount()
    const prefix = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
    const suffix = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: last, endColumn: model.getLineMaxColumn(last) })
    // The model URI is /<taskId>/<repoId>/<path>.
    const [, taskId = '', repoId = ''] = model.uri.path.split('/')
    const path = model.uri.path.split('/').slice(3).join('/')
    let result
    try { result = await invoke('completion.complete', { requestId, taskId, repoId, path, prefix, suffix, context: openFiles(model, taskId) }) } catch { return { items: [] } }
    if (result.status === 'ok') announce(null)
    else if (result.status !== 'skipped' && result.status !== 'disabled') announce(result.message)
    if (token.isCancellationRequested || result.status !== 'ok' || !result.text) return { items: [] }
    return { items: [{ insertText: result.text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] }
  },
  disposeInlineCompletions() {},
})
