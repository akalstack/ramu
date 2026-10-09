import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import type { RepositoryBinding, ViewDescriptor } from '../../../shared/types'
import { invoke, ramu } from '../ipc'
import { monaco } from '../monaco'
import { errorText } from '../TaskPane'
import { useAppSettings } from '../AppSettings'
import { useWorkspace } from '../workspace'
import { registerSelection } from '../editorBuffers'

type DiffViewDesc = Extract<ViewDescriptor, { kind: 'diff' }>

export function DiffView({ taskId, view, binding }: { taskId: string; view: DiffViewDesc; binding: RepositoryBinding }) {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false, request = 0, loaded = false
    const lang = monaco.editor.createModel('', undefined, monaco.Uri.from({ scheme: 'inmemory', path: `/${crypto.randomUUID()}/${view.path}` }))
    const languageId = lang.getLanguageId()
    lang.dispose()
    const original = monaco.editor.createModel('', languageId)
    const modified = monaco.editor.createModel('', languageId)
    const editor = monaco.editor.createDiffEditor(host.current!, {
      theme: 'ramu',
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      fontSize: preferences.editorFontSize,
      fontFamily: "'SF Mono', Menlo, 'Geist Mono Variable', monospace",
      fontLigatures: true,
      lineHeight: Math.round(preferences.editorFontSize * 1.6),
      smoothScrolling: true,
      renderSideBySide: true,
    })
    editor.setModel({ original, modified })

    editorRef.current = editor
    let selectionSide: 'original' | 'modified' = 'modified'
    const originalFocus = editor.getOriginalEditor().onDidFocusEditorText(() => { selectionSide = 'original' })
    const modifiedFocus = editor.getModifiedEditor().onDidFocusEditorText(() => { selectionSide = 'modified' })
    const unregisterSelection = registerSelection(view.id, () => {
      const pane = selectionSide === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor()
      const range = pane.getSelection(), model = pane.getModel()
      if (!loaded || !host.current?.getClientRects().length || !model || !range || range.isEmpty()) return undefined
      return { content: model.getValueInRange(range), selection: { startLine: range.startLineNumber, startColumn: range.startColumn, endLine: range.endLineNumber, endColumn: range.endColumn, side: selectionSide } }
    })
    const load = async () => {
      const current = ++request
      try {
        const diff = view.oid ? await invoke('git.commitFileDiff', taskId, binding.repoId, view.oid, view.path) : await invoke('git.diff', taskId, binding.repoId, view.path, view.staged)
        if (disposed || current !== request) return
        if (original.getValue() !== diff.original) original.setValue(diff.original)
        if (modified.getValue() !== diff.modified) modified.setValue(diff.modified)
        loaded = true
        setError(null)
      } catch (reason) { if (!disposed && current === request) setError(errorText(reason)) }
    }
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = ramu.on('fs:changed', ({ cwd, path }) => {
      if (view.oid || cwd !== binding.cwd || (path !== view.path && path !== '.git/index' && path !== '.git/HEAD')) return
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 100)
    })
    return () => {
      disposed = true
      off()
      clearTimeout(timer)
      editorRef.current = null
      unregisterSelection()
      originalFocus.dispose()
      modifiedFocus.dispose()
      editor.setModel(null)
      editor.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [taskId, binding.repoId, binding.cwd, view.path, view.staged, view.oid])

  useEffect(() => { editorRef.current?.updateOptions({ fontSize: preferences.editorFontSize, lineHeight: Math.round(preferences.editorFontSize * 1.6) }) }, [preferences.editorFontSize])

  return (
    <div className="file-view">
      <div className="view-header">
        <span className="strong">{binding.repoName}</span>
        <span className="path">{view.path}</span>
        <span className="muted small">{view.oid ? `${view.oid.slice(0, 7)} · Parent → commit` : view.staged ? 'Staged changes' : 'Unstaged changes'}</span>
        <Button onClick={() => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: view.path })}>Open file</Button>
      </div>
      {error && <div className="error banner">{error}</div>}
      <div ref={host} className="editor-host" />
    </div>
  )
}
