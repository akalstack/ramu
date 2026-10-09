import { nativeMonacoMenu } from './monacoMenu'
// Monaco with its web workers bundled by Vite (no CDN, no eval).
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

// Fallback only: with language servers on (see lsp.ts) Monaco's TypeScript features are switched off and the
// project's own TypeScript answers instead, including semantic errors. Without a server, files are checked one at a
// time without the project's tsconfig or node_modules, so unresolved imports would be noise; syntax errors stay on.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
  defaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    jsx: monaco.typescript.JsxEmit.Preserve,
    allowJs: true,
    allowNonTsExtensions: true,
  })
}

monaco.editor.defineTheme('ramu', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'scrollbarSlider.background': '#ffffff1a', 'scrollbarSlider.hoverBackground': '#ffffff30', 'scrollbarSlider.activeBackground': '#ffffff40', 'editorOverviewRuler.border': '#00000000', 'editor.background': '#1c1c1e', 'editorGutter.background': '#1c1c1e', 'editor.lineHighlightBackground': '#ffffff08', 'editorWidget.background': '#2c2c2e', 'diffEditor.insertedTextBackground': '#5fbd9128', 'diffEditor.insertedLineBackground': '#5fbd9110', 'diffEditor.removedTextBackground': '#e5808728', 'diffEditor.removedLineBackground': '#e5808710', 'editorGutter.addedBackground': '#5fbd91', 'editorGutter.modifiedBackground': '#d9a462', 'editorGutter.deletedBackground': '#e58087' },
})

// Slim scrollbars everywhere, to match the rest of the app.
const SLIM = { scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, verticalSliderSize: 6, horizontalSliderSize: 6, useShadows: false }, overviewRulerBorder: false, hideCursorInOverviewRuler: true } as const
monaco.editor.onDidCreateEditor((editor) => editor.updateOptions(SLIM))
monaco.editor.onDidCreateDiffEditor((diff) => diff.updateOptions({ ...SLIM, renderOverviewRuler: false }))

export { monaco }

monaco.editor.onDidCreateEditor(nativeMonacoMenu)
