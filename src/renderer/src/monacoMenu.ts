import * as monaco from 'monaco-editor/editor/editor.api.js'
import { invoke } from './ipc'
import { notifyError } from './Notifications'

const comments = new WeakMap<monaco.editor.ICodeEditor, () => void>()
export function reviewCommentMenu(editor: monaco.editor.ICodeEditor, action: () => void): () => void {
  comments.set(editor, action)
  return () => { comments.delete(editor) }
}
export function nativeMonacoMenu(editor: monaco.editor.ICodeEditor): void {
  editor.updateOptions({ contextmenu: false })
  const actions = { find: 'actions.find' }
  const show = async (point: { x: number; y: number }) => {
    const model = editor.getModel(), selection = editor.getSelection()
    if (!model || !selection) return
    const version = model.getVersionId()
    const editable = !editor.getOption(monaco.editor.EditorOption.readOnly)
    const result = await invoke('editor.menu', { selection: model.getValueInRange(selection), editable, comment: comments.has(editor) }, point)
    if (!result || editor.getModel() !== model) return
    editor.focus()
    if (typeof result === 'object' || result === 'cut') {
      if (!editable || editor.getOption(monaco.editor.EditorOption.readOnly)) return
      if (model.getVersionId() !== version) { notifyError('The file changed while the menu was open. Try the edit again.', 'Editor'); return }
      editor.pushUndoStop(); editor.executeEdits('native-menu', [{ range: selection, text: result === 'cut' ? '' : result.paste }]); editor.pushUndoStop()
    } else if (result === 'comment') comments.get(editor)?.()
    else if (result === 'selectAll') editor.setSelection(model.getFullModelRange())
    else if (result === 'undo' || result === 'redo') editor.trigger('native-menu', result, null)
    else await editor.getAction(actions[result])?.run()
  }
  const mouse = editor.onContextMenu((event) => {
    const target = event.event.browserEvent.target
    if (target instanceof Element && (target.closest('.review-inline-zone') || target.closest('input, textarea, [contenteditable="true"]') && !target.closest('.inputarea'))) return
    event.event.preventDefault(); event.event.stopPropagation()
    const position = event.target.position, selection = editor.getSelection()
    if (position && !selection?.containsPosition(position)) editor.setPosition(position)
    void show({ x: event.event.posx, y: event.event.posy }).catch((error) => notifyError(String(error), 'Editor'))
  })
  const key = editor.onKeyDown((event) => {
    if (event.browserEvent.key !== 'ContextMenu' && !(event.shiftKey && event.browserEvent.key === 'F10')) return
    event.preventDefault(); event.stopPropagation()
    const rect = editor.getDomNode()?.getBoundingClientRect(), cursor = editor.getPosition(), visible = cursor ? editor.getScrolledVisiblePosition(cursor) : null
    if (rect) void show({ x: rect.left + (visible?.left ?? 10), y: rect.top + (visible?.top ?? 10) + (visible?.height ?? 20) }).catch((error) => notifyError(String(error), 'Editor'))
  })
  editor.onDidDispose(() => { mouse.dispose(); key.dispose(); comments.delete(editor) })
}
