import { nativeMonacoMenu } from './monacoMenu'
// Editor core and text-editing features, without language services or completion providers.
import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import './monacoLanguages'
import 'monaco-editor/editor/browser/coreCommands.js'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/comment/browser/comment.js'
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js'
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js'
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection.js'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js'
import 'monaco-editor/editor/contrib/links/browser/links.js'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js'
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js'
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization.js'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js'
import 'monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations.js'
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

monaco.editor.defineTheme('ramu', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'scrollbarSlider.background': '#ffffff1a', 'scrollbarSlider.hoverBackground': '#ffffff30', 'scrollbarSlider.activeBackground': '#ffffff40', 'editorOverviewRuler.border': '#00000000', 'editor.background': '#1c1c1e', 'editorGutter.background': '#1c1c1e', 'editor.lineHighlightBackground': '#ffffff08', 'editorWidget.background': '#2c2c2e', 'diffEditor.insertedTextBackground': '#5fbd9128', 'diffEditor.insertedLineBackground': '#5fbd9110', 'diffEditor.removedTextBackground': '#e5808728', 'diffEditor.removedLineBackground': '#e5808710', 'editorGutter.addedBackground': '#5fbd91', 'editorGutter.modifiedBackground': '#d9a462', 'editorGutter.deletedBackground': '#e58087' },
})

// Static chat code blocks share the editor's token colors even before an editor opens.
monaco.editor.setTheme('ramu')

// Slim scrollbars everywhere, to match the rest of the app.
const SLIM = { scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, verticalSliderSize: 6, horizontalSliderSize: 6, useShadows: false }, overviewRulerBorder: false, hideCursorInOverviewRuler: true } as const
monaco.editor.onDidCreateEditor((editor) => editor.updateOptions(SLIM))
monaco.editor.onDidCreateDiffEditor((diff) => diff.updateOptions({ ...SLIM, renderOverviewRuler: false }))

export { monaco }

monaco.editor.onDidCreateEditor(nativeMonacoMenu)
