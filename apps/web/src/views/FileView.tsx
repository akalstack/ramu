import { ContentSkeleton } from '@/components/content-skeleton'
import { t, useLanguage } from './../i18n'
import { Button } from '@/components/desktop-button'
import { Columns2, Eye, Pencil, WrapText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MarkdownPreview } from '../editor/MarkdownPreview'
import { ChatFind } from '../chat/ChatFind'
import type { EditorConfigProps, RepositoryBinding, ViewDescriptor } from '@ramu/shared/types'
import { useAppSettings } from '../settings/AppSettings'
import { invoke, ramu } from '../ipc'
import { registerBuffer, registerSelection } from '../editor/editorBuffers'
import { onWorkspaceVisibility, workspaceVisible } from '../workspace/workspaceLifetime'
import { monaco } from '../editor/monaco'
import { applyEditorConfig, normalizeForSave } from '../editor/editorConfig'
import { errorText } from '../workspace/TaskPane'
import { useWorkspace } from '../workspace/workspace'
import { MediaFileView, isMedia } from './MediaFileView'

/** Word wrap is one choice for every editor, kept across sessions. */
const WRAP_KEY = 'ramu.word-wrap'
const readWrap = () => {
  try {
    return localStorage.getItem(WRAP_KEY) === 'on'
  } catch {
    return false
  }
}
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

type FileViewDesc = Extract<ViewDescriptor, { kind: 'file' }>

interface Conflict {
  disk: string | null
  diskHash: string
}

function TextFileView({ taskId, view, binding }: { taskId: string; view: FileViewDesc; binding: RepositoryBinding }) {
  useLanguage()
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const changingBuffer = useRef(false)
  const host = useRef<HTMLDivElement>(null)
  const diffHost = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const selection = useRef(view.selection)
  selection.current = view.selection
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
      theme: 'ramu',
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
      if (saving || !loaded.current || disposed) return
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
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => {
      const on = !readWrap()
      try {
        localStorage.setItem(WRAP_KEY, on ? 'on' : 'off')
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

    Promise.all([
      invoke('files.read', taskId, binding.repoId, view.path),
      invoke('files.editorconfig', taskId, binding.repoId, view.path).catch((): EditorConfigProps => ({})),
    ]).then(
      ([f, config]) => {
        if (disposed) return
        editorConfig = config
        model.setValue(f.content)
        applyEditorConfig(model, config)
        baseHash.current = f.hash
        savedVersion.current = model.getAlternativeVersionId()
        setDirty(view.id, false)
        editor.updateOptions({ readOnly: false })
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

    // Agents, terminals and other tools write to the same files.
    const readDisk = async () => {
      if (!loaded.current || !workspaceVisible()) return
      const current = ++diskRequest
      const disk = await invoke('files.read', taskId, binding.repoId, view.path).catch(() => null)
      if (disposed || current !== diskRequest) return
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
    const off = ramu.on('fs:changed', ({ cwd, path }) => {
      if (cwd === binding.cwd && path === view.path) void readDisk()
    })
    const visibility = onWorkspaceVisibility(() => {
      if (workspaceVisible()) void readDisk()
    })

    return () => {
      disposed = true
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
  }, [taskId, binding.repoId, binding.cwd, view.path, view.id, setDirty])

  const [wrap, setWrapState] = useState(readWrap)
  const setWrap = (on: boolean) => {
    try {
      localStorage.setItem(WRAP_KEY, on ? 'on' : 'off')
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
  // Markdown files can be previewed beside the editor or instead of it; the preview follows the buffer as you type.
  const markdown = isMarkdown(view.path)
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('edit')
  const [previewText, setPreviewText] = useState('')
  // Find in the rendered preview (the editor's own find only sees source). In split mode the editor keeps Monaco's find;
  // this one answers when focus is in the preview, or when the preview is all there is.
  const previewPane = useRef<HTMLDivElement>(null)
  const [findingPreview, setFindingPreview] = useState(false)
  const [findRequest, setFindRequest] = useState(0)
  useEffect(() => {
    if (markdown && mode === 'preview') previewPane.current?.focus({ preventScroll: true })
  }, [markdown, mode])
  useEffect(() => {
    if (mode === 'edit') setFindingPreview(false)
  }, [mode])
  // Split mode: the editor drives the preview. The line at the top of the editor is matched to the headings around it in the
  // source and the same headings in the preview, so a long document stays in step even with images and code blocks
  // (a plain scroll percentage drifts). The preview never scrolls the editor back, which is what makes two-way sync jitter.
  // Block sync, both ways. A selection in the editor is marked in the preview's rendered text; a selection in the preview selects
  // the matching source in the editor (without taking focus). The rendered text drops markup, so the match is by words, and a
  // guard keeps one side's update from echoing back.
  useEffect(() => {
    const editor = editorRef.current
    if (!markdown || mode !== 'split' || !editor) return
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const pane = () => previewPane.current
    const words = (text: string) =>
      text
        .toLowerCase()
        .replace(/[`*_~>#|\\[\]()-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
    let echo = false
    const mark = () => {
      const el = pane(),
        model = editor.getModel(),
        selection = editor.getSelection()
      registry?.delete('md-sync')
      if (!el || !model || !selection || selection.isEmpty() || !registry || !window.Highlight) return
      const wanted = words(model.getValueInRange(selection)).slice(0, 400)
      if (wanted.length < 1) return
      // Walk the preview's text nodes as one word stream and take the span where the selected words occur in order.
      const nodes: { node: Text; start: number; end: number; word: string }[] = []
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement?.closest('.chat-find-bar, script, style')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      })
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        for (const m of n.data.matchAll(/\S+/g))
          nodes.push({
            node: n,
            start: m.index!,
            end: m.index! + m[0].length,
            word: m[0].toLowerCase().replace(/[`*_~>#|\\[\]()-]/g, ''),
          })
      }
      const clean = nodes.filter((entry) => entry.word)
      const line = editor.getVisibleRanges()[0]?.startLineNumber ?? 1
      const total = Math.max(1, model.getLineCount())
      // Several places may read the same words; take the one nearest the same relative position in the document.
      let best = -1,
        bestGap = Infinity
      const expected = ((selection.startLineNumber || line) - 1) / total
      for (let i = 0; i + wanted.length <= clean.length; i++) {
        if (clean[i]!.word !== wanted[0] || clean[i + wanted.length - 1]!.word !== wanted[wanted.length - 1]) continue
        if (!wanted.every((word, k) => clean[i + k]!.word === word.replace(/[`*_~>#|\\[\]()-]/g, ''))) continue
        const gap = Math.abs(i / Math.max(1, clean.length) - expected)
        if (gap < bestGap) {
          best = i
          bestGap = gap
        }
      }
      if (best < 0) return
      const first = clean[best]!,
        last = clean[best + wanted.length - 1]!
      const range = new Range()
      range.setStart(first.node, first.start)
      range.setEnd(last.node, last.end)
      registry.set('md-sync', new window.Highlight(range))
    }
    const select = () => {
      const el = pane(),
        model = editor.getModel(),
        selection = document.getSelection()
      if (
        !el ||
        !model ||
        !selection ||
        selection.isCollapsed ||
        !selection.rangeCount ||
        !el.contains(selection.getRangeAt(0).commonAncestorContainer)
      )
        return
      const all = words(selection.toString())
      if (!all.length) return
      const head = all.slice(0, 4),
        tail = all.slice(-4)
      const separator = '[\\s`*_~>#|\\[\\]()-]+'
      const pattern = (list: string[]) => list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(separator)
      const visible = editor.getVisibleRanges()[0]?.startLineNumber ?? 1
      const nearest = (matches: { range: import('monaco-editor').IRange }[]) =>
        matches.sort(
          (x, y) => Math.abs(x.range.startLineNumber - visible) - Math.abs(y.range.startLineNumber - visible),
        )[0]
      const start = nearest(model.findMatches(pattern(head), false, true, false, null, false, 200))
      if (!start) return
      const ends = model
        .findMatches(pattern(tail), false, true, false, null, false, 400)
        .filter(
          (m) =>
            m.range.startLineNumber > start.range.startLineNumber ||
            (m.range.startLineNumber === start.range.startLineNumber && m.range.startColumn >= start.range.startColumn),
        )
      const end =
        (all.length <= 4 ? start : ends.sort((x, y) => x.range.startLineNumber - y.range.startLineNumber)[0]) ?? start
      echo = true
      editor.setSelection({
        startLineNumber: start.range.startLineNumber,
        startColumn: start.range.startColumn,
        endLineNumber: end.range.endLineNumber,
        endColumn: end.range.endColumn,
      })
      editor.revealRangeInCenterIfOutsideViewport(editor.getSelection()!)
      window.setTimeout(() => {
        echo = false
      }, 0)
    }
    const cursor = editor.onDidChangeCursorSelection(() => {
      if (!echo) mark()
      else registry?.delete('md-sync')
    })
    document.addEventListener('selectionchange', select)
    mark()
    return () => {
      cursor.dispose()
      document.removeEventListener('selectionchange', select)
      registry?.delete('md-sync')
    }
  }, [markdown, mode, loadedTick, previewText])
  useEffect(() => {
    const editor = editorRef.current
    if (!markdown || mode !== 'split' || !editor) return
    const sync = () => {
      const pane = previewPane.current,
        model = editor.getModel()
      if (!pane || !model) return
      const headings = [
        ...pane.querySelectorAll<HTMLElement>(
          '.md-preview h1, .md-preview h2, .md-preview h3, .md-preview h4, .md-preview h5, .md-preview h6',
        ),
      ]
      const lines: number[] = []
      let fence = false
      for (let n = 1; n <= model.getLineCount(); n++) {
        const text = model.getLineContent(n)
        if (/^\s*(```|~~~)/.test(text)) {
          fence = !fence
          continue
        }
        if (!fence && /^ {0,3}#{1,6}\s/.test(text)) lines.push(n)
      }
      const top = editor.getVisibleRanges()[0]?.startLineNumber ?? 1
      const total = model.getLineCount()
      const paneTop = pane.getBoundingClientRect().top - pane.scrollTop
      const offsetOf = (index: number) => headings[index]!.getBoundingClientRect().top - paneTop - 16
      // Only when both sides saw the same headings; otherwise fall back to the proportional position.
      let target: number
      if (lines.length && lines.length === headings.length) {
        let before = -1
        for (let i = 0; i < lines.length; i++) if (lines[i]! <= top) before = i
        const fromLine = before < 0 ? 1 : lines[before]!,
          toLine = before + 1 < lines.length ? lines[before + 1]! : total + 1
        const fromY = before < 0 ? 0 : offsetOf(before),
          toY = before + 1 < lines.length ? offsetOf(before + 1) : pane.scrollHeight - pane.clientHeight
        target = fromY + (toY - fromY) * Math.min(1, Math.max(0, (top - fromLine) / Math.max(1, toLine - fromLine)))
      } else target = ((top - 1) / Math.max(1, total - 1)) * (pane.scrollHeight - pane.clientHeight)
      pane.scrollTop = target
    }
    const subscription = editor.onDidScrollChange((event) => {
      if (event.scrollTopChanged) sync()
    })
    sync()
    return () => subscription.dispose()
  }, [markdown, mode, loadedTick, previewText])
  useEffect(() => {
    if (!markdown || mode === 'edit') return
    const model = editorRef.current?.getModel()
    if (!model) return
    setPreviewText(model.getValue())
    let timer: number | undefined
    const subscription = model.onDidChangeContent(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setPreviewText(model.getValue()), 150)
    })
    return () => {
      window.clearTimeout(timer)
      subscription.dispose()
    }
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
      theme: 'ramu',
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
        {markdown && (
          <span
            className="view-header-group inline-flex gap-px p-0.5 [border:1px_solid_transparent] rounded-(--radius-s) bg-fill"
            role="group"
            aria-label={t('Markdown view')}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
              aria-pressed={mode === 'edit'}
              aria-label={t('Editor only')}
              title={t('Editor only')}
              onClick={() => setMode('edit')}
            >
              <Pencil size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
              aria-pressed={mode === 'split'}
              aria-label={t('Editor and preview side by side')}
              title={t('Preview beside the editor')}
              onClick={() => setMode('split')}
            >
              <Columns2 size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
              aria-pressed={mode === 'preview'}
              aria-label={t('Preview only')}
              title={t('Preview only')}
              onClick={() => setMode('preview')}
            >
              <Eye size={14} />
            </Button>
          </span>
        )}
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
        {loading && <ContentSkeleton variant="editor" rows={12} className="absolute inset-0 z-10 bg-canvas" />}
        <div
          ref={host}
          className="editor-host flex-1 min-h-0"
          style={{ display: markdown && mode === 'preview' ? 'none' : 'block' }}
        />
        {markdown && mode !== 'edit' && (
          <div
            ref={previewPane}
            tabIndex={-1}
            onKeyDown={(event) => {
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
            className="relative outline-none md-preview-pane [flex:1_1_0] min-w-0 overflow-auto [border-left:1px_solid_var(--line)] p-[16px_24px_32px]"
          >
            <div className="md-preview [&_h1]:text-[length:1.6em] [&_h1]:m-[0_0_12px] [&_h1]:pb-1.5 [&_h1]:[border-bottom:1px_solid_var(--line)] [&_h2]:text-[length:1.3em] [&_h2]:m-[20px_0_8px] [&_h2]:pb-1 [&_h2]:[border-bottom:1px_solid_var(--line)] [&_h3]:text-[length:1.1em] [&_img]:max-w-full [&_.md-frontmatter]:mb-4 [&_.md-frontmatter]:p-[8px_12px] [&_.md-frontmatter]:[border:1px_solid_transparent] [&_.md-frontmatter]:rounded-(--radius-s) [&_.md-frontmatter]:text-soft [&_.md-frontmatter]:bg-fill [&_.md-frontmatter_summary]:cursor-pointer [&_.md-frontmatter_summary]:text-control [&_.md-frontmatter_pre]:mb-0 [&_blockquote]:m-[8px_0] [&_blockquote]:p-[2px_12px] [&_blockquote]:[border-left:3px_solid_var(--line-strong)] [&_blockquote]:text-soft [&_hr]:[border:0] [&_hr]:[border-top:1px_solid_var(--line)] [&_hr]:m-[16px_0] max-w-[820px] m-[0_auto] text-chat leading-[1.65] select-text msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words assistant">
              <MarkdownPreview
                text={previewText}
                taskId={taskId}
                repoId={binding.repoId}
                path={view.path}
                onOpenFile={(path) => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path })}
              />
            </div>
          </div>
        )}
        {markdown && mode !== 'edit' && findingPreview && (
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

/** Images, PDFs, audio and video open in a preview; everything else opens in the editor. */
export function FileView(props: { taskId: string; view: FileViewDesc; binding: RepositoryBinding }) {
  return isMedia(props.view.path) ? <MediaFileView {...props} /> : <TextFileView {...props} />
}
