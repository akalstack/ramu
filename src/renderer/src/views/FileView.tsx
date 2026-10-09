import { Button } from '@/components/ui/button'
import { Columns2, Eye, Pencil, WrapText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MarkdownPreview } from '../MarkdownPreview'
import type { LintResult, RepositoryBinding, ViewDescriptor } from '../../../shared/types'
import { useAppSettings } from '../AppSettings'
import { invoke, ramu } from '../ipc'
import { setAiCompletionEnabled, setNextEditEnabled } from '../aiCompletion'
import { openLspDocument, setFileOpener, setLanguageServersEnabled } from '../lsp'
import { registerBuffer, registerSelection } from '../editorBuffers'
import { monaco } from '../monaco'
import { notifyError } from '../Notifications'
import { errorText } from '../TaskPane'
import { useWorkspace } from '../workspace'

/** Word wrap is one choice for every editor, kept across sessions. */
const WRAP_KEY = 'ramu.word-wrap'
const readWrap = () => { try { return localStorage.getItem(WRAP_KEY) === 'on' } catch { return false } }
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

type FileViewDesc = Extract<ViewDescriptor, { kind: 'file' }>

const SEVERITY = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info }
/** Only the editor the user last typed in answers the Format Document command. */
let lastFocused: monaco.editor.IStandaloneCodeEditor | null = null

interface Problems { errors: number; warnings: number; tools: string[]; failures: string[] }
const NO_PROBLEMS: Problems = { errors: 0, warnings: 0, tools: [], failures: [] }

interface Conflict {
    disk: string | null
    diskHash: string
}

export function FileView({ taskId, view, binding }: { taskId: string; view: FileViewDesc; binding: RepositoryBinding }) {
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
    const revealMatch = () => {
        const target = selection.current, editor = editorRef.current
        if (!loaded.current || !target || !editor) return
        editor.setSelection({ startLineNumber: target.line, endLineNumber: target.line, startColumn: target.column, endColumn: target.endColumn })
        editor.revealLineInCenter(target.line)
        if (host.current?.offsetParent !== null) editor.focus()
    }
    useEffect(() => { revealMatch() }, [view.selection?.requestId])
    const baseHash = useRef<string | null>(null)
    const savedVersion = useRef(0)
    const [error, setError] = useState<string | null>(null)
    const [conflict, setConflict] = useState<Conflict | null>(null)
    const [comparing, setComparing] = useState(false)
    const [aiStatus, setAiStatus] = useState<string | null>(null)
    const [problems, setProblems] = useState<Problems>(NO_PROBLEMS)
    const syncLspRef = useRef<() => void>(() => { })
    const prefsRef = useRef(preferences)
    prefsRef.current = preferences
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
        } finally { changingBuffer.current = false }
    }

    useEffect(() => {
        loaded.current = false
        let disposed = false, saving = false, diskRequest = 0
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
        // The language server follows the editor buffer once the file has loaded, and only while servers are enabled.
        let closeLsp: (() => void) | null = null
        const syncLsp = () => {
            if (disposed || !loaded.current) return
            if (prefsRef.current.languageServers && !closeLsp) closeLsp = openLspDocument(model, { taskId, repoId: binding.repoId, path: view.path, cwd: binding.cwd })
            else if (!prefsRef.current.languageServers && closeLsp) { closeLsp(); closeLsp = null }
        }
        syncLspRef.current = syncLsp
        const unregisterBuffer = registerBuffer(ws.workspaceOf(taskId), binding.repoId, view.path, () => loaded.current ? model.getValue() : undefined)
        const unregisterSelection = registerSelection(view.id, () => {
            const range = editor.getSelection()
            if (!loaded.current || !host.current?.getClientRects().length || !range || range.isEmpty()) return undefined
            return { content: model.getValueInRange(range), selection: { startLine: range.startLineNumber, startColumn: range.startColumn, endLine: range.endLineNumber, endColumn: range.endColumn } }
        })
        editorRef.current = editor

        // Markers are grouped per tool, so each linter's results replace only their own.
        const owners = new Map<string, { live: boolean; label: string; errors: number; warnings: number }>()
        let lintSeq = 0, lintTimer: ReturnType<typeof setTimeout> | undefined
        const publish = (failures: string[]) => {
            const entries = [...owners.values()]
            setProblems({ errors: entries.reduce((sum, e) => sum + e.errors, 0), warnings: entries.reduce((sum, e) => sum + e.warnings, 0), tools: entries.map((e) => e.label), failures })
        }
        const lint = async (scope: 'buffer' | 'saved') => {
            if (!loaded.current || disposed) return
            const seq = ++lintSeq, version = model.getVersionId()
            let result: LintResult
            try { result = await invoke('files.lint', taskId, binding.repoId, view.path, model.getValue(), scope) } catch { return }
            // Drop answers about text that has since changed.
            if (disposed || seq !== lintSeq || model.getVersionId() !== version) return
            for (const tool of result.tools) {
                const found = result.diagnostics.filter((d) => d.tool === tool.id)
                monaco.editor.setModelMarkers(model, `ramu-lint:${tool.id}`, found.map((d) => ({
                    severity: SEVERITY[d.severity], message: d.message, source: tool.label,
                    code: d.code ? (d.url ? { value: d.code, target: monaco.Uri.parse(d.url) } : d.code) : undefined,
                    startLineNumber: d.line, startColumn: d.column, endLineNumber: d.endLine, endColumn: d.endColumn,
                })))
                owners.set(tool.id, { live: tool.live, label: tool.label, errors: found.filter((d) => d.severity === 'error').length, warnings: found.filter((d) => d.severity === 'warning').length })
            }
            publish(result.errors)
        }
        // One live lint per file at a time: edits made while it runs queue a single trailing run, so slow
        // linters cannot pile up processes while the user types.
        let bufferLinting = false, lintAgain = false
        const lintBuffer = async () => {
            if (bufferLinting) { lintAgain = true; return }
            bufferLinting = true
            try { await lint('buffer') } finally {
                bufferLinting = false
                if (lintAgain && !disposed) { lintAgain = false; void lintBuffer() }
            }
        }
        const scheduleLint = () => {
            clearTimeout(lintTimer)
            if (prefsRef.current.lintWhileEditing) lintTimer = setTimeout(() => void lintBuffer(), 800)
        }
        // Tools that only read the saved file describe text that has now changed, so their markers would drift.
        const dropFileBasedMarkers = () => {
            let changed = false
            for (const [id, entry] of owners) if (!entry.live) { monaco.editor.setModelMarkers(model, `ramu-lint:${id}`, []); owners.delete(id); changed = true }
            if (changed) publish([])
        }

        /** Applies formatted text as one undoable edit that touches only the changed middle, so the cursor stays put. */
        const applyFormatted = (text: string) => {
            const before = model.getValue()
            let start = 0
            while (start < before.length && start < text.length && before[start] === text[start]) start++
            let endBefore = before.length, endText = text.length
            while (endBefore > start && endText > start && before[endBefore - 1] === text[endText - 1]) { endBefore--; endText-- }
            const from = model.getPositionAt(start), to = model.getPositionAt(endBefore)
            editor.pushUndoStop()
            editor.executeEdits('ramu-format', [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: text.slice(start, endText) }])
            editor.pushUndoStop()
        }
        /** Formats with the project's own formatter, or Monaco's built-in one when the project has none. */
        const format = async () => {
            if (!loaded.current || disposed) return
            const version = model.getVersionId()
            let result
            try { result = await invoke('files.format', taskId, binding.repoId, view.path, model.getValue()) } catch (e) { notifyError(errorText(e), 'Format'); return }
            if (disposed || model.getVersionId() !== version) return
            if (result.error) { notifyError(`${result.label}: ${result.error}`, 'Format'); return }
            if (result.tool === null) { await editor.getAction('editor.action.formatDocument')?.run(); return }
            if (result.content !== null && result.content !== model.getValue()) applyFormatted(result.content)
        }

        const save = async () => {
            if (saving || !loaded.current || disposed) return
            saving = true
            if (prefsRef.current.formatOnSave) try { await format() } catch { /* saving continues without formatting */ }
            if (disposed) { saving = false; return }
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
                    void lint('saved')
                } else {
                    const disk = await invoke('files.read', taskId, binding.repoId, view.path).then((f) => f.content, () => null)
                    if (!disposed) setConflict({ disk, diskHash: res.diskHash })
                }
            } catch (e) {
                if (!disposed) setError(errorText(e))
            } finally { saving = false }
        }
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
        editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => { const on = !readWrap(); try { localStorage.setItem(WRAP_KEY, on ? 'on' : 'off') } catch { /* private mode */ } window.dispatchEvent(new CustomEvent('ramu:word-wrap', { detail: on })) })
        const saveAll = () => { if (isDirty()) void save() }
        window.addEventListener('ramu:save-all', saveAll)
        const sub = model.onDidChangeContent(() => { if (loaded.current && !changingBuffer.current) { setDirty(view.id, isDirty()); dropFileBasedMarkers(); scheduleLint() } })
        const focusSub = editor.onDidFocusEditorText(() => { lastFocused = editor })
        const nativeFormat = editor.addAction({ id: 'ramu.formatDocument', label: 'Format document', run: () => format() })
        const formatCommand = () => { if (lastFocused === editor && host.current?.offsetParent !== null) void format() }
        window.addEventListener('ramu:format', formatCommand)

        invoke('files.read', taskId, binding.repoId, view.path).then(
            (f) => {
                if (disposed) return
                model.setValue(f.content)
                baseHash.current = f.hash
                savedVersion.current = model.getAlternativeVersionId()
                setDirty(view.id, false)
                editor.updateOptions({ readOnly: false })
                loaded.current = true
                setLoadedTick((tick) => tick + 1)
                revealMatch()
                void lint('saved')
                syncLsp()
            },
            (e) => { if (!disposed) setError(errorText(e)) },
        )

        // Agents, terminals and other tools write to the same files.
        const off = ramu.on('fs:changed', async ({ cwd, path }) => {
            if (cwd !== binding.cwd || path !== view.path || !loaded.current) return
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
                void lint('saved')
            } else {
                setConflict({ disk: disk?.content ?? null, diskHash })
            }
        })

        return () => {
            disposed = true
            off()
            window.removeEventListener('ramu:save-all', saveAll)
            window.removeEventListener('ramu:format', formatCommand)
            clearTimeout(lintTimer)
            for (const id of owners.keys()) monaco.editor.setModelMarkers(model, `ramu-lint:${id}`, [])
            if (lastFocused === editor) lastFocused = null
            nativeFormat.dispose()
            focusSub.dispose()
            closeLsp?.(); syncLspRef.current = () => { }
            sub.dispose()
            editor.dispose()
            unregisterBuffer()
            unregisterSelection()
            model.dispose()
            editorRef.current = null
        }
    }, [taskId, binding.repoId, binding.cwd, view.path, view.id, setDirty])

    useEffect(() => { setLanguageServersEnabled(preferences.languageServers); syncLspRef.current() }, [preferences.languageServers])
    useEffect(() => {
        setFileOpener((openTaskId, repoId, path, selection) => ws.openView(openTaskId, { kind: 'file', repoId, path, selection: { ...selection, requestId: crypto.randomUUID() } }))
        return () => setFileOpener(null)
    }, [ws])
    useEffect(() => {
        setAiCompletionEnabled(preferences.aiCompletion.enabled)
        setNextEditEnabled(preferences.aiCompletion.enabled && preferences.aiCompletion.nextEdit && preferences.aiCompletion.nextEditAck && preferences.aiCompletion.provider === 'codestral')
        if (!preferences.aiCompletion.enabled) setAiStatus(null)
    }, [preferences.aiCompletion.enabled, preferences.aiCompletion.nextEdit, preferences.aiCompletion.nextEditAck, preferences.aiCompletion.provider])
    useEffect(() => {
        const onStatus = (event: Event) => setAiStatus((event as CustomEvent<string | null>).detail)
        window.addEventListener('ramu:completion-status', onStatus)
        return () => window.removeEventListener('ramu:completion-status', onStatus)
    }, [])

    const [wrap, setWrapState] = useState(readWrap)
    const setWrap = (on: boolean) => { try { localStorage.setItem(WRAP_KEY, on ? 'on' : 'off') } catch { /* private mode */ } window.dispatchEvent(new CustomEvent('ramu:word-wrap', { detail: on })) }
    useEffect(() => {
        const apply = (event: Event) => { const on = (event as CustomEvent<boolean>).detail; setWrapState(on); editorRef.current?.updateOptions({ wordWrap: on ? 'on' : 'off' }) }
        window.addEventListener('ramu:word-wrap', apply)
        return () => window.removeEventListener('ramu:word-wrap', apply)
    }, [])
    // Markdown files can be previewed beside the editor or instead of it; the preview follows the buffer as you type.
    const markdown = isMarkdown(view.path)
    const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('edit')
    const [previewText, setPreviewText] = useState('')
    useEffect(() => {
        if (!markdown || mode === 'edit') return
        const model = editorRef.current?.getModel()
        if (!model) return
        setPreviewText(model.getValue())
        let timer: number | undefined
        const subscription = model.onDidChangeContent(() => { window.clearTimeout(timer); timer = window.setTimeout(() => setPreviewText(model.getValue()), 150) })
        return () => { window.clearTimeout(timer); subscription.dispose() }
    }, [markdown, mode, view.path, loadedTick])
    useEffect(() => { editorRef.current?.updateOptions({ fontSize: preferences.editorFontSize, lineHeight: Math.round(preferences.editorFontSize * 1.6) }) }, [preferences.editorFontSize])

    // Side-by-side comparison of the disk version and the unsaved buffer.
    useEffect(() => {
        if (!comparing || !conflict || !diffHost.current) return
        const original = monaco.editor.createModel(conflict.disk ?? '', undefined)
        const modified = editorRef.current!.getModel()!
        const diff = monaco.editor.createDiffEditor(diffHost.current, { theme: 'ramu', automaticLayout: true, readOnly: false, originalEditable: false })
        diff.setModel({ original, modified })
        monaco.editor.setModelLanguage(original, modified.getLanguageId())
        return () => {
            diff.setModel(null)
            diff.dispose()
            original.dispose()
        }
    }, [comparing, conflict])

    return (
        <div className="file-view">
            <div className="view-header">
                <span className="strong">{binding.repoName}</span>
                <span className="path">{view.path}</span>
                {aiStatus && preferences.aiCompletion.enabled && <span className="lint-summary has-warnings" title={aiStatus}>AI completion paused</span>}
                {(problems.tools.length > 0 || problems.failures.length > 0) && <span className={`lint-summary${problems.errors ? ' has-errors' : problems.warnings ? ' has-warnings' : ''}`} title={[...problems.failures, `Checked by ${problems.tools.join(', ')}`].filter(Boolean).join('\n')}>
                    {problems.failures.length > 0 ? 'Lint unavailable' : !problems.errors && !problems.warnings ? `${problems.tools.join(' · ')} · no problems` : `${problems.errors ? `${problems.errors} error${problems.errors > 1 ? 's' : ''}` : ''}${problems.errors && problems.warnings ? ', ' : ''}${problems.warnings ? `${problems.warnings} warning${problems.warnings > 1 ? 's' : ''}` : ''}`}
                </span>}
                {markdown && <span className="view-header-group" role="group" aria-label="Markdown view">
                    <Button className="ghost icon small-icon" aria-pressed={mode === 'edit'} aria-label="Editor only" title="Editor only" onClick={() => setMode('edit')}><Pencil size={14} /></Button>
                    <Button className="ghost icon small-icon" aria-pressed={mode === 'split'} aria-label="Editor and preview side by side" title="Preview beside the editor" onClick={() => setMode('split')}><Columns2 size={14} /></Button>
                    <Button className="ghost icon small-icon" aria-pressed={mode === 'preview'} aria-label="Preview only" title="Preview only" onClick={() => setMode('preview')}><Eye size={14} /></Button>
                </span>}
                <Button className="ghost icon small-icon" aria-pressed={wrap} aria-label="Word wrap" title={`Word wrap: ${wrap ? 'on' : 'off'} (⌥Z)`} onClick={() => setWrap(!wrap)}><WrapText size={14} /></Button>
            </div>
            {error && <div className="error banner">{error}</div>}
            {conflict && (
                <div className="banner warn">
                    {conflict.disk === null ? 'This file was deleted on disk.' : 'This file changed on disk while you have unsaved edits.'}
                    {conflict.disk !== null && (
                        <>
                            <Button onClick={() => setComparing((c) => !c)}>{comparing ? 'Hide comparison' : 'Compare'}</Button>
                            <Button
                                onClick={() => {
                                    replaceBuffer(conflict.disk!)
                                    baseHash.current = conflict.diskHash
                                    savedVersion.current = editorRef.current!.getModel()!.getAlternativeVersionId()
                                    setDirty(view.id, false)
                                    setConflict(null)
                                    setComparing(false)
                                }}
                                title="Your edits stay in undo history (⌘Z)"
                            >
                                Use disk version
                            </Button>
                        </>
                    )}
                    <Button
                        onClick={() => {
                            baseHash.current = conflict.diskHash || null
                            setConflict(null)
                            setComparing(false)
                        }}
                        title="The next save overwrites the disk version"
                    >
                        Keep mine
                    </Button>
                </div>
            )}
            <div ref={diffHost} className="editor-host" style={{ display: comparing ? 'block' : 'none' }} />
            <div className="file-body" style={{ display: comparing ? 'none' : 'flex' }}>
                <div ref={host} className="editor-host" style={{ display: markdown && mode === 'preview' ? 'none' : 'block' }} />
        {markdown && mode !== 'edit' && <div className="md-preview-pane"><div className="md-preview msg assistant"><MarkdownPreview text={previewText} taskId={taskId} repoId={binding.repoId} path={view.path} onOpenFile={(path) => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path, preview: false })} /></div></div>}
            </div>
        </div>
    )
}
