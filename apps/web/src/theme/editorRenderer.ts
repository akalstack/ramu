// This entry runs on ramu-theme:, independently of the workspace's Monaco and native bridge.
import { monaco } from '../editor/monacoCore'
import { defineEditorTheme, loadShikiLanguage } from '../editor/shiki'
import { editorColorsForVariant } from '../editor/editorTheme'
import { parseThemeEditorUpdate, type ThemeEditorUpdate } from '@ramu/shared/themePreview'

const BEFORE =
  'export function total(price: number, quantity: number) {\n  // Include every item in the order.\n  return price + quantity\n}\n'
const AFTER = BEFORE.replace('price + quantity', 'price * quantity')
const instance = decodeURIComponent(location.hash.slice(1))
const root = document.getElementById('editor')!
const original = monaco.editor.createModel(BEFORE, 'typescript')
const modified = monaco.editor.createModel(AFTER, 'typescript')
let editor: monaco.editor.IStandaloneCodeEditor | monaco.editor.IStandaloneDiffEditor | null = null
let mode: 'code' | 'diff' | undefined
let revision = 0
let latestRequest = 0
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const send = (type: string, request?: number) =>
  parent.postMessage({ ramuThemePreview: 1, instance, type, request }, '*')
const options = {
  readOnly: true,
  automaticLayout: true,
  contextmenu: false,
  fontSize: 12,
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  padding: { top: 8 },
}
const viewState: {
  code?: monaco.editor.ICodeEditorViewState | null
  diff?: monaco.editor.IDiffEditorViewState | null
} = {}
function show(update: ThemeEditorUpdate) {
  if (mode !== update.view) {
    if (editor && mode === 'code') viewState.code = (editor as monaco.editor.IStandaloneCodeEditor).saveViewState()
    if (editor && mode === 'diff') viewState.diff = (editor as monaco.editor.IStandaloneDiffEditor).saveViewState()
    editor?.dispose()
    root.replaceChildren()
    mode = update.view
    if (mode === 'code') {
      const code = monaco.editor.create(root, { ...options, model: modified })
      if (viewState.code) code.restoreViewState(viewState.code)
      editor = code
    } else {
      const diff = monaco.editor.createDiffEditor(root, {
        ...options,
        originalEditable: false,
        renderSideBySide: update.split,
        useInlineViewWhenSpaceIsLimited: false,
      })
      diff.setModel({ original, modified })
      if (viewState.diff) diff.restoreViewState(viewState.diff)
      editor = diff
    }
  } else if (mode === 'diff')
    (editor as monaco.editor.IStandaloneDiffEditor).updateOptions({ renderSideBySide: update.split })
}
async function apply(update: ThemeEditorUpdate, mine: number) {
  try {
    await loadShikiLanguage('typescript')
    const name = `ramu-preview-${mine}`
    await defineEditorTheme(name, update.appearance, editorColorsForVariant(update.variant, update.appearance))
    if (disposed || mine !== revision) return
    document.documentElement.style.colorScheme = update.appearance
    document.body.style.background = update.variant.colors.canvas
    monaco.editor.setTheme(name)
    show(update)
    send('applied', update.request)
  } catch {
    if (!disposed && mine === revision) send('error', update.request)
  }
}
window.addEventListener('message', (event) => {
  if (event.source !== parent) return
  const update = parseThemeEditorUpdate(event.data)
  if (!update || update.instance !== instance) return
  if (update.request <= latestRequest) return
  latestRequest = update.request
  const mine = ++revision
  clearTimeout(timer)
  timer = setTimeout(() => void apply(update, mine), 150)
})
window.addEventListener(
  'pagehide',
  () => {
    disposed = true
    revision++
    clearTimeout(timer)
    editor?.dispose()
    original.dispose()
    modified.dispose()
  },
  { once: true },
)
send('ready')
