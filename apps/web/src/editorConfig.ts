import { monaco } from './monaco'
import type { editor } from 'monaco-editor'
import type { EditorConfigProps } from '@ramu/shared/types'

/** Used when neither .editorconfig nor the file's own content says how it is indented. */
const FALLBACK = { insertSpaces: true, tabSize: 4 }

/**
 * Applies .editorconfig to a model. Indentation the config leaves unset is detected from the file's content,
 * so a file without a matching config keeps the style it already has.
 */
export function applyEditorConfig(model: editor.ITextModel, props: EditorConfigProps) {
  const size = props.indentSize === 'tab' ? props.tabWidth : props.indentSize ?? props.tabWidth
  const spaces = props.indentStyle ? props.indentStyle === 'space' : undefined
  if (spaces === undefined || size === undefined) model.detectIndentation(spaces ?? FALLBACK.insertSpaces, size ?? FALLBACK.tabSize)
  // Whatever the config does say wins over what was detected.
  model.updateOptions({ ...(spaces === undefined ? {} : { insertSpaces: spaces }), ...(size === undefined ? {} : { tabSize: props.tabWidth ?? size, indentSize: size }) })
  if (props.endOfLine) model.setEOL(props.endOfLine === 'crlf' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
}

/** Applies trim_trailing_whitespace and insert_final_newline as one undoable edit before a save. */
export function normalizeForSave(model: editor.ITextModel, props: EditorConfigProps) {
  const edits: editor.IIdentifiedSingleEditOperation[] = []
  const lines = model.getLineCount()
  if (props.trimTrailingWhitespace) {
    for (let line = 1; line <= lines; line++) {
      const column = model.getLineMaxColumn(line), first = model.getLineLastNonWhitespaceColumn(line)
      if (first < column) edits.push({ range: { startLineNumber: line, startColumn: first || 1, endLineNumber: line, endColumn: column }, text: '' })
    }
  }
  if (props.insertFinalNewline && model.getValueLength() > 0 && model.getLineMaxColumn(lines) > 1) {
    const column = model.getLineMaxColumn(lines)
    edits.push({ range: { startLineNumber: lines, startColumn: column, endLineNumber: lines, endColumn: column }, text: model.getEOL() })
  }
  if (!edits.length) return
  model.pushStackElement()
  model.pushEditOperations([], edits, () => null)
  model.pushStackElement()
}
