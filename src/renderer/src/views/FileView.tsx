import { ContentSkeleton } from '@/components/content-skeleton'
import { t, useLanguage } from './../i18n'
import { Button } from '@/components/desktop-button'
import { Columns2, Eye, Pencil, WrapText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MarkdownPreview } from '../MarkdownPreview'
import type { LintResult, RepositoryBinding, ViewDescriptor } from '../../../shared/types'
import { useAppSettings } from '../AppSettings'
import { invoke, ramu } from '../ipc'
import { registerBuffer, registerSelection } from '../editorBuffers'
import { monaco } from '../monaco'
import { errorText } from '../TaskPane'
import { useWorkspace } from '../workspace'
import { MediaFileView, isMedia } from './MediaFileView'

/** Word wrap is one choice for every editor, kept across sessions. */
const WRAP_KEY = 'ramu.word-wrap'
const readWrap = () => { try { return localStorage.getItem(WRAP_KEY) === 'on' } catch { return false } }
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

type FileViewDesc = Extract<ViewDescriptor, { kind: 'file' }>

const SEVERITY = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info }
interface Problems { errors: number; warnings: number; tools: string[]; failures: string[] }
const NO_PROBLEMS: Problems = { errors: 0, warnings: 0, tools: [], failures: [] }

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
    const [problems, setProblems] = useState<Problems>(NO_PROBLEMS)
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
        setLoading(true)
        setError(null)
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

        const save = async () => {
            if (saving || !loaded.current || disposed) return
            saving = true
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

        invoke('files.read', taskId, binding.repoId, view.path).then(
            (f) => {
                if (disposed) return
                model.setValue(f.content)
                baseHash.current = f.hash
                savedVersion.current = model.getAlternativeVersionId()
                setDirty(view.id, false)
                editor.updateOptions({ readOnly: false })
                loaded.current = true
                setLoading(false)
                setLoadedTick((tick) => tick + 1)
                revealMatch()
                void lint('saved')
            },
            (e) => { if (!disposed) { setError(errorText(e)); setLoading(false) } },
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
            clearTimeout(lintTimer)
            for (const id of owners.keys()) monaco.editor.setModelMarkers(model, `ramu-lint:${id}`, [])
            sub.dispose()
            editor.dispose()
            unregisterBuffer()
            unregisterSelection()
            model.dispose()
            editorRef.current = null
        }
    }, [taskId, binding.repoId, binding.cwd, view.path, view.id, setDirty])

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
        <div className="file-view flex flex-col flex-1 min-h-0 min-w-0">
            <div className="view-header [&_.path]:flex-1 [&_button]:text-control [&_button]:p-[2px_8px] [&_[aria-pressed='true']]:bg-hover [&_[aria-pressed='true']]:text-foreground flex gap-2.5 items-center h-8 p-[0_12px] flex-none min-w-0 text-control text-soft">
                <span className="strong font-semibold">{binding.repoName}</span>
                <span className="path text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{view.path}</span>
                {(problems.tools.length > 0 || problems.failures.length > 0) && <span className={`lint-summary [&.has-errors]:text-bad [&.has-warnings]:text-warn text-caption text-muted-foreground whitespace-nowrap${problems.errors ? ' has-errors' : problems.warnings ? ' has-warnings' : ''}`} title={[...problems.failures, `Checked by ${problems.tools.join(', ')}`].filter(Boolean).join('\n')}>
                    {problems.failures.length > 0 ? t("Lint unavailable") : !problems.errors && !problems.warnings ? t("{0} · no problems", { "0": problems.tools.join(' · ') }) : `${problems.errors ? `${problems.errors} error${problems.errors > 1 ? 's' : ''}` : ''}${problems.errors && problems.warnings ? ', ' : ''}${problems.warnings ? `${problems.warnings} warning${problems.warnings > 1 ? 's' : ''}` : ''}`}
                </span>}
                {markdown && <span className="view-header-group inline-flex gap-px p-0.5 [border:1px_solid_transparent] rounded-(--radius-s) bg-fill" role="group" aria-label={t("Markdown view")}>
                    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-pressed={mode === 'edit'} aria-label={t("Editor only")} title={t("Editor only")} onClick={() => setMode('edit')}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-pressed={mode === 'split'} aria-label={t("Editor and preview side by side")} title={t("Preview beside the editor")} onClick={() => setMode('split')}><Columns2 size={14} /></Button>
                    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-pressed={mode === 'preview'} aria-label={t("Preview only")} title={t("Preview only")} onClick={() => setMode('preview')}><Eye size={14} /></Button>
                </span>}
                <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-pressed={wrap} aria-label={t("Word wrap")} title={t("Word wrap: {0} (⌥Z)", { "0": wrap ? 'on' : 'off' })} onClick={() => setWrap(!wrap)}><WrapText size={14} /></Button>
            </div>
            {error && <div className="error text-bad banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control">{error}</div>}
            {conflict && (
                <div className="banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control warn text-warn">
                    {conflict.disk === null ? t("This file was deleted on disk.") : t("This file changed on disk while you have unsaved edits.")}
                    {conflict.disk !== null && (
                        <>
                            <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setComparing((c) => !c)}>{comparing ? t("Hide comparison") : t("Compare")}</Button>
                            <Button variant="secondary" className="bg-fill hover:bg-fill-hover"
                                onClick={() => {
                                    replaceBuffer(conflict.disk!)
                                    baseHash.current = conflict.diskHash
                                    savedVersion.current = editorRef.current!.getModel()!.getAlternativeVersionId()
                                    setDirty(view.id, false)
                                    setConflict(null)
                                    setComparing(false)
                                }}
                                title={t("Your edits stay in undo history (⌘Z)")}
                            >
                                {t("Use disk version")}</Button>
                        </>
                    )}
                    <Button variant="secondary" className="bg-fill hover:bg-fill-hover"
                        onClick={() => {
                            baseHash.current = conflict.diskHash || null
                            setConflict(null)
                            setComparing(false)
                        }}
                        title={t("The next save overwrites the disk version")}
                    >
                        {t("Keep mine")}</Button>
                </div>
            )}
            <div ref={diffHost} className="editor-host flex-1 min-h-0" style={{ display: comparing ? 'block' : 'none' }} />
            <div className="file-body relative [&_>_.editor-host]:[flex:1_1_0] [&_>_.editor-host]:min-w-0 flex-1 min-h-0 min-w-0 flex" style={{ display: comparing ? 'none' : 'flex' }}>
                {loading && <ContentSkeleton variant="editor" rows={12} className="absolute inset-0 z-10 bg-canvas" />}
                <div ref={host} className="editor-host flex-1 min-h-0" style={{ display: markdown && mode === 'preview' ? 'none' : 'block' }} />
        {markdown && mode !== 'edit' && <div className="md-preview-pane [flex:1_1_0] min-w-0 overflow-auto [border-left:1px_solid_var(--line)] p-[16px_24px_32px]"><div className="md-preview [&_h1]:text-[length:1.6em] [&_h1]:m-[0_0_12px] [&_h1]:pb-1.5 [&_h1]:[border-bottom:1px_solid_var(--line)] [&_h2]:text-[length:1.3em] [&_h2]:m-[20px_0_8px] [&_h2]:pb-1 [&_h2]:[border-bottom:1px_solid_var(--line)] [&_h3]:text-[length:1.1em] [&_img]:max-w-full [&_.md-frontmatter]:mb-4 [&_.md-frontmatter]:p-[8px_12px] [&_.md-frontmatter]:[border:1px_solid_transparent] [&_.md-frontmatter]:rounded-(--radius-s) [&_.md-frontmatter]:text-soft [&_.md-frontmatter]:bg-fill [&_.md-frontmatter_summary]:cursor-pointer [&_.md-frontmatter_summary]:text-control [&_.md-frontmatter_pre]:mb-0 [&_blockquote]:m-[8px_0] [&_blockquote]:p-[2px_12px] [&_blockquote]:[border-left:3px_solid_var(--line-strong)] [&_blockquote]:text-soft [&_hr]:[border:0] [&_hr]:[border-top:1px_solid_var(--line)] [&_hr]:m-[16px_0] max-w-[820px] m-[0_auto] text-chat leading-[1.65] select-text msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words assistant"><MarkdownPreview text={previewText} taskId={taskId} repoId={binding.repoId} path={view.path} onOpenFile={(path) => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path })} /></div></div>}
            </div>
        </div>
    )
}

/** Images, PDFs, audio and video open in a preview; everything else opens in the editor. */
export function FileView(props: { taskId: string; view: FileViewDesc; binding: RepositoryBinding }) {
  return isMedia(props.view.path) ? <MediaFileView {...props} /> : <TextFileView {...props} />
}
