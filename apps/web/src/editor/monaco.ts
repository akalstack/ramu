import { nativeMonacoMenu } from './monacoMenu'
// Editor core and text-editing features, without language services or completion providers.
import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import './monacoLanguages'
import { RAMU_EDITOR_COLORS, RAMU_EDITOR_COLORS_LIGHT, editorThemeName } from './editorTheme'
import { setupShiki } from './shiki'
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
  colors: RAMU_EDITOR_COLORS,
})

// Static chat code blocks share the editor's token colors even before an editor opens. Monaco's own dark
// tokens show until Shiki finishes loading; it then redefines this theme with TextMate colors.
monaco.editor.defineTheme('ramu-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: RAMU_EDITOR_COLORS_LIGHT,
})
monaco.editor.setTheme(editorThemeName())
setupShiki()

// Slim scrollbars everywhere, to match the rest of the app.
const SLIM = {
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
    verticalSliderSize: 6,
    horizontalSliderSize: 6,
    useShadows: false,
  },
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
} as const
monaco.editor.onDidCreateEditor((editor) => editor.updateOptions(SLIM))
monaco.editor.onDidCreateDiffEditor((diff) => diff.updateOptions({ ...SLIM, renderOverviewRuler: false }))

export { monaco }

monaco.editor.onDidCreateEditor(nativeMonacoMenu)
