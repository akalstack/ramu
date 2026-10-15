import { ContentSkeleton } from '@/components/content-skeleton'
import { t, useLanguage } from './../i18n'
import { Button } from '@/components/desktop-button'
import { useEffect, useRef, useState } from 'react'
import type { RepositoryBinding, ViewDescriptor } from '@ramu/shared/types'
import { invoke, ramu } from '../ipc'
import { monaco } from '../editor/monaco'
import { errorText } from '../workspace/TaskPane'
import { useAppSettings } from '../settings/AppSettings'
import { useWorkspace } from '../workspace/workspace'
import { registerSelection } from '../editor/editorBuffers'

type DiffViewDesc = Extract<ViewDescriptor, { kind: 'diff' }>

export function DiffView({
  taskId,
  view,
  binding,
}: {
  taskId: string
  view: DiffViewDesc
  binding: RepositoryBinding
}) {
  useLanguage()
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false,
      request = 0,
      loaded = false
    setLoading(true)
    setError(null)
    const lang = monaco.editor.createModel(
      '',
      undefined,
      monaco.Uri.from({ scheme: 'inmemory', path: `/${crypto.randomUUID()}/${view.path}` }),
    )
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
    const originalFocus = editor.getOriginalEditor().onDidFocusEditorText(() => {
      selectionSide = 'original'
    })
    const modifiedFocus = editor.getModifiedEditor().onDidFocusEditorText(() => {
      selectionSide = 'modified'
    })
    const unregisterSelection = registerSelection(view.id, () => {
      const pane = selectionSide === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor()
      const range = pane.getSelection(),
        model = pane.getModel()
      if (!loaded || !host.current?.getClientRects().length || !model || !range || range.isEmpty()) return undefined
      return {
        content: model.getValueInRange(range),
        selection: {
          startLine: range.startLineNumber,
          startColumn: range.startColumn,
          endLine: range.endLineNumber,
          endColumn: range.endColumn,
          side: selectionSide,
        },
      }
    })
    const load = async () => {
      const current = ++request
      try {
        const diff = view.oid
          ? await invoke(
              view.stash ? 'git.stashFileDiff' : 'git.commitFileDiff',
              taskId,
              binding.repoId,
              view.oid,
              view.path,
            )
          : await invoke('git.diff', taskId, binding.repoId, view.path, view.staged)
        if (disposed || current !== request) return
        if (original.getValue() !== diff.original) original.setValue(diff.original)
        if (modified.getValue() !== diff.modified) modified.setValue(diff.modified)
        loaded = true
        setError(null)
      } catch (reason) {
        if (!disposed && current === request) setError(errorText(reason))
      } finally {
        if (!disposed && current === request) setLoading(false)
      }
    }
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = ramu.on('fs:changed', ({ cwd, path }) => {
      if (view.oid || cwd !== binding.cwd || (path !== view.path && path !== '.git/index' && path !== '.git/HEAD'))
        return
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
  }, [taskId, binding.repoId, binding.cwd, view.path, view.staged, view.oid, view.stash])

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: preferences.editorFontSize,
      lineHeight: Math.round(preferences.editorFontSize * 1.6),
    })
  }, [preferences.editorFontSize])

  return (
    <div className="file-view flex flex-col flex-1 min-h-0 min-w-0">
      <div className="view-header [&_.path]:flex-1 [&_button]:text-control [&_button]:p-[2px_8px] [&_[aria-pressed='true']]:bg-hover [&_[aria-pressed='true']]:text-foreground flex gap-2.5 items-center h-8 p-[0_12px] flex-none min-w-0 text-control text-soft">
        <span className="strong font-semibold">{binding.repoName}</span>
        <span className="path text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {view.path}
        </span>
        <span className="muted text-muted-foreground small text-caption">
          {view.oid
            ? t(view.stash ? '{0} · Base → stash' : '{0} · Parent → commit', { '0': view.oid.slice(0, 7) })
            : view.staged === 'all'
              ? t('Changes')
              : view.staged
                ? t('Staged changes')
                : t('Unstaged changes')}
        </span>
        <Button
          variant="secondary"
          className="bg-fill hover:bg-fill-hover"
          onClick={() => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: view.path })}
        >
          {t('Open file')}
        </Button>
      </div>
      {error && (
        <div className="error text-bad banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control">
          {error}
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div ref={host} className="editor-host h-full" />
        {loading && (
          <div className="absolute inset-0 flex bg-canvas">
            <ContentSkeleton variant="editor" rows={12} className="flex-1" />
            <ContentSkeleton variant="editor" rows={12} className="flex-1 border-l border-border" />
          </div>
        )}
      </div>
    </div>
  )
}
