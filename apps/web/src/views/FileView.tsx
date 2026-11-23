import { WorkspaceAccessBoundary } from '../components/workspace-access-boundary'
import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { cn } from 'cn'
import { t, useLanguage } from './../i18n'
import { Button } from '@/components/desktop-button'
import { WrapText } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownViewControl, initialMarkdownView } from '../editor/MarkdownViewControl'
import type { AppPreferences } from '@ramu/shared/types'
import { MarkdownEditor } from '../editor/MarkdownEditor'
import { MarkdownPreview } from '../editor/MarkdownPreview'
import { ChatFind } from '../chat/ChatFind'
const MermaidBlock = lazy(() => import('../chat/MermaidBlock').then((m) => ({ default: m.MermaidBlock })))
import type { EditorConfigProps, RepositoryBinding, ViewDescriptor } from '@ramu/shared/types'
import { useAppSettings } from '../settings/AppSettings'
import { registerBuffer, registerSelection } from '../editor/editorBuffers'
import { onWorkspaceVisibility, workspaceVisible } from '../workspace/workspaceLifetime'
import { monaco } from '../editor/monaco'
import { applyEditorConfig, normalizeForSave } from '../editor/editorConfig'
import { errorText } from '../workspace/TaskPane'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { useHost } from '../workspace/HostProvider'
import { useOpenFileLink } from '../workspace/useOpenFileLink'
import type { MarkdownLinkTarget } from '@ramu/shared/workspace/fileLinks'
import { MediaFileView, isMedia, isSvg } from './MediaFileView'
import { deviceStorage } from '../deviceStorage'
import { editorThemeName } from '../editor/editorTheme'

/** Word wrap is one choice for every editor, kept across sessions. */
const WRAP_KEY = 'ramu.word-wrap'
const readWrap = () => {
  try {
    return deviceStorage.getItem(WRAP_KEY) === 'on'
  } catch {
    return false
  }
}
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)
const isDiagram = (path: string) => /\.(mmd|mermaid)$/i.test(path)

type FileViewDesc = Extract<ViewDescriptor, { kind: 'file' }>

interface Conflict {
  disk: string | null
  diskHash: string
}

function TextFileView({
  taskId,
  view,
  binding,
  onViewImage,
}: {
  taskId: string
  view: FileViewDesc
  binding: RepositoryBinding
  /** Offered for SVG, which opens as an image by default. */
  onViewImage?: () => void
}) {
  useLanguage()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const ws = useWorkspace()
  const { invoke, status: hostStatus } = useHost()
  const { on: onHostEvent } = useHostRuntime()
  const { preferences } = useAppSettings()
  const openFileLink = useOpenFileLink(taskId)
  // A link in a Markdown file opens the file at its line or reveals a folder, from this document's repository.
  const openMarkdownLink = useCallback(
    (target: MarkdownLinkTarget) =>
      openFileLink(target.kind === 'repository' ? `${binding.cwd.replace(/\/$/, '')}/${target.path}` : target.href),
    [openFileLink, binding.cwd],
  )
  const changingBuffer = useRef(false)
  const host = useRef<HTMLDivElement>(null)
  const diffHost = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const selection = useRef(view.selection)
  selection.current = view.selection
  const loadRef = useRef<(() => void) | null>(null)
  const loaded = useRef(false)
  const [loadedTick, setLoadedTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const revealMatch = () => {
    const target = selection.current,
      editor = editorRef.current
    if (!loaded.current || !target || !editor) return
    editor.setSelection({
      startLineNumber: target.line,
      endLineNumber: target.line,
      startColumn: target.column,
      endColumn: target.endColumn,
    })
    editor.revealLineInCenter(target.line)
    if (host.current?.offsetParent !== null) editor.focus()
  }
  useEffect(() => {
    revealMatch()
  }, [view.selection?.requestId])
  const baseHash = useRef<string | null>(null)
  const savedVersion = useRef(0)
  const saveRef = useRef<() => void>(() => {})
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [comparing, setComparing] = useState(false)
  const conflictRef = useRef(conflict)
  conflictRef.current = conflict
  const { setDirty } = ws

  const isDirty = () => {
    const m = editorRef.current?.getModel()
    return !!m && m.getAlternativeVersionId() !== savedVersion.current
  }

  /** Replaces the buffer as an undoable edit, so Cmd+Z brings the previous buffer back. */
  const replaceBuffer = (text: string) => {
    const model = editorRef.current?.getModel()
    if (!model) return
    changingBuffer.current = true
    try {
      model.pushStackElement()
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
      model.pushStackElement()
    } finally {
      changingBuffer.current = false
    }
  }

  useEffect(() => {
    loaded.current = false
    setLoading(true)
    setError(null)
    let disposed = false,
      saving = false,
      diskRequest = 0
    let editorConfig: EditorConfigProps = {}
    const uri = monaco.Uri.from({ scheme: 'file', path: `/${taskId}/${binding.repoId}/${view.path}` })
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel('', undefined, uri)
    const editor = monaco.editor.create(host.current!, {
      model,
      theme: editorThemeName(),
      automaticLayout: true,
      fontSize: preferences.editorFontSize,
      fontFamily: "'SF Mono', Menlo, 'Geist Mono Variable', monospace",
      fontLigatures: true,
      wordWrap: readWrap() ? 'on' : 'off',
      lineHeight: Math.round(preferences.editorFontSize * 1.6),
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      padding: { top: 8 },
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      // Read-only until the disk content arrives, so early keystrokes cannot be clobbered by the load.
      readOnly: true,
    })
    const unregisterBuffer = registerBuffer(ws.workspaceOf(taskId), binding.repoId, view.path, () =>
      loaded.current ? model.getValue() : undefined,
    )
    const unregisterSelection = registerSelection(view.id, () => {
      const range = editor.getSelection()
      if (!loaded.current || !host.current?.getClientRects().length || !range || range.isEmpty()) return undefined
      return {
        content: model.getValueInRange(range),
        selection: {
          startLine: range.startLineNumber,
          startColumn: range.startColumn,
          endLine: range.endLineNumber,
          endColumn: range.endColumn,
        },
      }
    })
    editorRef.current = editor

    const save = async () => {
      if (!canWrite() || saving || !loaded.current || disposed) return
      saving = true
      normalizeForSave(model, editorConfig)
      const version = model.getAlternativeVersionId()
      const content = model.getValue()
      try {
        const res = await invoke('files.write', taskId, binding.repoId, view.path, content, baseHash.current)
        if (disposed) return
        if (res.ok) {
          baseHash.current = res.hash
          savedVersion.current = version
          setConflict(null)
          setDirty(view.id, isDirty())
        } else {
          const disk = await invoke('files.read', taskId, binding.repoId, view.path).then(
            (f) => f.content,
            () => null,
          )
          if (!disposed) setConflict({ disk, diskHash: res.diskHash })
        }
      } catch (e) {
        if (!disposed) setError(errorText(e))
      } finally {
        saving = false
      }
    }
    saveRef.current = () => void save()
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => {
      const on = !readWrap()
      try {
        deviceStorage.setItem(WRAP_KEY, on ? 'on' : 'off')
      } catch {
        /* private mode */
      }
      window.dispatchEvent(new CustomEvent('ramu:word-wrap', { detail: on }))
    })
    const saveAll = () => {
      if (isDirty()) void save()
    }
    window.addEventListener('ramu:save-all', saveAll)
    const sub = model.onDidChangeContent(() => {
      if (loaded.current && !changingBuffer.current) setDirty(view.id, isDirty())
    })

    let reading = false
    const load = () => {
      if (reading || loaded.current || disposed || !canWrite()) return
      reading = true
      setLoading(true)
      setError(null)
      void Promise.all([
        invoke('files.read', taskId, binding.repoId, view.path),
        invoke('files.editorconfig', taskId, binding.repoId, view.path).catch((): EditorConfigProps => ({})),
      ])
        .then(
          ([f, config]) => {
            if (disposed) return
            editorConfig = config
            model.setValue(f.content)
            applyEditorConfig(model, config)
            baseHash.current = f.hash
            savedVersion.current = model.getAlternativeVersionId()
            setDirty(view.id, false)
            editor.updateOptions({ readOnly: !canWrite() })
            loaded.current = true
            setLoading(false)
            setLoadedTick((tick) => tick + 1)
            revealMatch()
          },
          (e) => {
            if (!disposed) {
              setError(errorText(e))
              setLoading(false)
            }
          },
        )
        .finally(() => {
          reading = false
        })
    }
    loadRef.current = load
    load()

    // Agents, terminals and other tools write to the same files.
    const readDisk = async () => {
      if (!canWrite() || !loaded.current || !workspaceVisible()) return
      const current = ++diskRequest
      const disk = await invoke('files.read', taskId, binding.repoId, view.path).catch(() => null)
      if (!canWrite() || disposed || current !== diskRequest) return
      const diskHash = disk?.hash ?? ''
      if (diskHash === baseHash.current || (conflictRef.current && conflictRef.current.diskHash === diskHash)) return
      if (!isDirty() && disk) {
        replaceBuffer(disk.content)
        baseHash.current = disk.hash
        savedVersion.current = model.getAlternativeVersionId()
        setDirty(view.id, false)
      } else {
        setConflict({ disk: disk?.content ?? null, diskHash })
      }
    }
    const off = onHostEvent('fs:changed', ({ cwd, path }) => {
      if (cwd === binding.cwd && path === view.path) void readDisk()
    })
    const visibility = onWorkspaceVisibility(() => {
      if (workspaceVisible()) void readDisk()
    })

    return () => {
      disposed = true
      loadRef.current = null
      off()
      visibility()
      window.removeEventListener('ramu:save-all', saveAll)
      sub.dispose()
      editor.dispose()
      unregisterBuffer()
      unregisterSelection()
      model.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [taskId, binding.repoId, binding.cwd, view.path, view.id, setDirty, ...] by design; the values it reads beyond these are current as of that run
  }, [taskId, binding.repoId, binding.cwd, view.path, view.id, setDirty, invoke, onHostEvent, canWrite])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: viewOnly || !loaded.current })
    if (!viewOnly) loadRef.current?.()
  }, [viewOnly, hostStatus])

  const [wrap, setWrapState] = useState(readWrap)
  const setWrap = (on: boolean) => {
    try {
      deviceStorage.setItem(WRAP_KEY, on ? 'on' : 'off')
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new CustomEvent('ramu:word-wrap', { detail: on }))
  }
  useEffect(() => {
    const apply = (event: Event) => {
      const on = (event as CustomEvent<boolean>).detail
      setWrapState(on)
      editorRef.current?.updateOptions({ wordWrap: on ? 'on' : 'off' })
    }
    window.addEventListener('ramu:word-wrap', apply)
    return () => window.removeEventListener('ramu:word-wrap', apply)
  }, [])
  const diagram = isDiagram(view.path)
  // A Mermaid file previews as its diagram; it has no rendered editor, so the edit preference shows the preview.
  const markdown = isMarkdown(view.path) || diagram
  const [chosenMode, setMode] = useState<AppPreferences['defaultMarkdownView']>(() =>
    initialMarkdownView(preferences.defaultMarkdownView, !!view.selection),
  )
  const mode = diagram && chosenMode === 'edit' ? 'preview' : chosenMode
  const [previewText, setPreviewText] = useState('')
  const previewPane = useRef<HTMLDivElement>(null)
  const [findingPreview, setFindingPreview] = useState(false)
  const [findRequest, setFindRequest] = useState(0)
  useEffect(() => {
    if (view.selection) setMode('source')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [view.selection?.requestId] by design; the values it reads beyond these are current as of that run
  }, [view.selection?.requestId])
  useEffect(() => {
    setFindingPreview(false)
    if (mode === 'source') {
      editorRef.current?.layout()
      revealMatch()
    }
  }, [mode])
  useEffect(() => {
    if (!markdown || mode !== 'preview') return
    const model = editorRef.current?.getModel()
    if (!model) return
    setPreviewText(model.getValue())
    const subscription = model.onDidChangeContent(() => setPreviewText(model.getValue()))
    return () => subscription.dispose()
  }, [markdown, mode, view.path, loadedTick])
  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: preferences.editorFontSize,
      lineHeight: Math.round(preferences.editorFontSize * 1.6),
    })
  }, [preferences.editorFontSize])

  // Side-by-side comparison of the disk version and the unsaved buffer.
  useEffect(() => {
    if (!comparing || !conflict || !diffHost.current) return
    const original = monaco.editor.createModel(conflict.disk ?? '', undefined)
    const modified = editorRef.current!.getModel()!
    const diff = monaco.editor.createDiffEditor(diffHost.current, {
      theme: editorThemeName(),
      automaticLayout: true,
      readOnly: false,
      originalEditable: false,
    })
    diff.setModel({ original, modified })
    monaco.editor.setModelLanguage(original, modified.getLanguageId())
    return () => {
      diff.setModel(null)
      diff.dispose()
      original.dispose()
    }
  }, [comparing, conflict])

  return (
    <div className="file-view flex flex-col flex-1 min-h-0 min-w-0">
      <div className="view-header [&_.path]:flex-1 [&_button]:text-control [&_button]:p-[2px_8px] [&_[aria-pressed='true']]:bg-hover [&_[aria-pressed='true']]:text-foreground flex gap-2.5 items-center h-8 p-[0_12px] flex-none min-w-0 text-control text-soft">
        <span className="strong font-semibold">{binding.repoName}</span>
        <span className="path text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {view.path}
        </span>
        {markdown && <MarkdownViewControl mode={mode} onChange={setMode} diagram={diagram} />}
        {onViewImage && (
          <Button variant="ghost" size="sm" onClick={onViewImage}>
            {t('View image')}
          </Button>
        )}
        {(!markdown || mode === 'source') && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            aria-pressed={wrap}
            aria-label={t('Word wrap')}
            title={t('Word wrap: {0} (⌥Z)', { '0': wrap ? 'on' : 'off' })}
            onClick={() => setWrap(!wrap)}
          >
            <WrapText size={14} />
          </Button>
        )}
      </div>
      {error && (
        <div className="error text-bad banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control">
          {error}
        </div>
      )}
      {conflict && (
        <div className="banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control warn text-warn">
          {conflict.disk === null
            ? t('This file was deleted on disk.')
            : t('This file changed on disk while you have unsaved edits.')}
          {conflict.disk !== null && (
            <>
              <Button
                variant="secondary"
                className="bg-fill hover:bg-fill-hover"
                onClick={() => setComparing((c) => !c)}
              >
                {comparing ? t('Hide comparison') : t('Compare')}
              </Button>
              <Button
                variant="secondary"
                className="bg-fill hover:bg-fill-hover"
                onClick={() => {
                  if (!canWrite()) return
                  replaceBuffer(conflict.disk!)
                  baseHash.current = conflict.diskHash
                  savedVersion.current = editorRef.current!.getModel()!.getAlternativeVersionId()
                  setDirty(view.id, false)
                  setConflict(null)
                  setComparing(false)
                }}
                title={t('Your edits stay in undo history (⌘Z)')}
              >
                {t('Use disk version')}
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover"
            onClick={() => {
              if (!canWrite()) return
              baseHash.current = conflict.diskHash || null
              setConflict(null)
              setComparing(false)
            }}
            title={t('The next save overwrites the disk version')}
          >
            {t('Keep mine')}
          </Button>
        </div>
      )}
      <div ref={diffHost} className="editor-host flex-1 min-h-0" style={{ display: comparing ? 'block' : 'none' }} />
      <div
        className="file-body relative [&_>_.editor-host]:[flex:1_1_0] [&_>_.editor-host]:min-w-0 flex-1 min-h-0 min-w-0 flex"
        style={{ display: comparing ? 'none' : 'flex' }}
      >
        <div
          ref={host}
          className="editor-host flex-1 min-h-0"
          style={{ display: markdown && mode !== 'source' ? 'none' : 'block' }}
        />
        {markdown && mode !== 'source' && (
          <div
            ref={previewPane}
            tabIndex={-1}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
                event.preventDefault()
                event.stopPropagation()
                saveRef.current()
              }
              if (
                (event.metaKey || event.ctrlKey) &&
                !event.shiftKey &&
                !event.altKey &&
                event.key.toLowerCase() === 'f'
              ) {
                event.preventDefault()
                event.stopPropagation()
                setFindingPreview(true)
                setFindRequest((n) => n + 1)
              }
            }}
            className={cn(
              'relative outline-none md-preview-pane flex-1 min-h-0 min-w-0',
              mode === 'edit' ? 'overflow-hidden' : 'overflow-auto p-[16px_24px_80px]',
            )}
          >
            <div className={mode === 'edit' ? 'h-full min-h-0' : diagram ? 'select-text' : 'max-w-[820px] m-[0_auto]'}>
              {mode === 'edit' && !loading && editorRef.current?.getModel() ? (
                <MarkdownEditor
                  model={editorRef.current.getModel()!}
                  viewId={view.id}
                  path={view.path}
                  image={(local) => invoke('files.image', taskId, binding.repoId, local)}
                  onSave={() => saveRef.current()}
                  onOpenLink={openMarkdownLink}
                />
              ) : mode === 'preview' && diagram ? (
                <Suspense fallback={null}>
                  <MermaidBlock source={previewText} />
                </Suspense>
              ) : mode === 'preview' ? (
                <MarkdownPreview
                  text={previewText}
                  taskId={taskId}
                  repoId={binding.repoId}
                  path={view.path}
                  onOpenLink={openMarkdownLink}
                />
              ) : null}
            </div>
          </div>
        )}
        {markdown && mode !== 'source' && findingPreview && (
          <ChatFind
            root={previewPane}
            focusRequest={findRequest}
            onClose={() => {
              setFindingPreview(false)
              previewPane.current?.focus({ preventScroll: true })
            }}
          />
        )}
      </div>
    </div>
  )
}

/** Images, PDFs, audio and video open in a preview; SVG opens as an image with its source one click away. */
export function FileView(props: { taskId: string; view: FileViewDesc; binding: RepositoryBinding }) {
  const { path, selection } = props.view
  const [source, setSource] = useState(!!selection)
  // Jumping to a line (a finding, a search hit) means the person wants the code.
  useEffect(() => setSource(!!selection), [path, selection])
  const svg = isSvg(path)
  return (
    <WorkspaceAccessBoundary>
      {isMedia(path) && !(svg && source) ? (
        <MediaFileView {...props} onViewSource={svg ? () => setSource(true) : undefined} />
      ) : (
        <TextFileView {...props} onViewImage={svg ? () => setSource(false) : undefined} />
      )}
    </WorkspaceAccessBoundary>
  )
}
