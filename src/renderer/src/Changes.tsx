import { t, useLanguage, formatLocale } from './i18n'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dropdown } from './Menu'
import { SearchInput } from './SearchInput'
import { useReviewDraft } from './reviewDrafts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardCheck, FileDiff, ExternalLink, Info, MessageSquarePlus, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeFile, ChangeReview, ReviewComment, ReviewFileState, ViewDescriptor } from '../../shared/types'
import { invoke, ramu } from './ipc'
import { useWorkspace } from './workspace'
import { ReviewDiff, enterReviewFile, type InlineReviewBlock } from './ReviewDiff'
import { UndoReview } from './UndoRun'
import { LineStats } from './LineStats'
import { useReviews, openReview } from './reviews'
import { VirtualList } from './VirtualList'
import { useAppSettings } from './AppSettings'
import { useNearViewport } from './useNearViewport'

const revealListeners = new Map<string, Set<(event: CustomEvent) => void>>()
const revealFile = (event: Event) => { const request = event as CustomEvent; if (!request.detail?.replayed) revealListeners.get(request.detail?.fileId)?.forEach((listener) => listener(request)) }

export function ChangeReviewTab({ view, visible = true }: { view: Extract<ViewDescriptor, { kind: 'review' }>; visible?: boolean }) {
    useLanguage()
    const ws = useWorkspace(), { reviews } = useReviews()
    const id = view.reviewId
    const readViewed = (): string[] => { try { const value = JSON.parse(localStorage.getItem(`ramu.review-viewed:${id}`) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] } }
    const [viewedState, setViewedState] = useState(() => ({ id, files: readViewed() }))
    const viewedFiles = useMemo(() => new Set(viewedState.id === id ? viewedState.files : readViewed()), [viewedState, id])
    const markViewed = (fileId: string, viewed: boolean) => {
        const next = new Set(viewedFiles); viewed ? next.add(fileId) : next.delete(fileId)
        const files = [...next]; setViewedState({ id, files })
        try { localStorage.setItem(`ramu.review-viewed:${id}`, JSON.stringify(files)) } catch { }
    }
    const [review, setReview] = useState<ChangeReview | null>(null)
    const [sideBySide, setSideBySide] = useState(() => { try { return localStorage.getItem('ramu.review-layout') !== 'inline' } catch { return true } })
    const changeLayout = (split: boolean) => { setSideBySide(split); try { localStorage.setItem('ramu.review-layout', split ? 'split' : 'inline') } catch { } }
    const [activeFileId, setActiveFileId] = useState<string | null>(null), [showAll, setShowAll] = useState(false)
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
    const [live, setLive] = useState<ReviewFileState[]>([]), [checking, setChecking] = useState(false), [liveError, setLiveError] = useState<string | null>(null)
    const inspectionSeq = useRef(0)
    const inspect = useCallback(async () => {
        if (!id) return
        const seq = ++inspectionSeq.current
        setChecking(true)
        try { const states = await invoke('reviews.inspect', id); if (currentId.current === id && seq === inspectionSeq.current) { setLive(states); setLiveError(null) } }
        catch (e) { if (currentId.current === id && seq === inspectionSeq.current) setLiveError(String(e)) }
        finally { if (currentId.current === id && seq === inspectionSeq.current) setChecking(false) }
    }, [id])
    const root = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const page = root.current, bar = page?.querySelector<HTMLElement>('.pair-review-bar')
        if (!page || !bar) return
        const measure = () => page.style.setProperty('--review-toolbar-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`)
        const observer = new ResizeObserver(measure); observer.observe(bar); measure()
        return () => observer.disconnect()
    }, [review?.id])
    const currentId = useRef(id); currentId.current = id
    useEffect(() => { setReview(null); setError(null); setLive([]); setLiveError(null); inspectionSeq.current++ }, [id])
    const threadTarget = view.threadId
    useEffect(() => {
        const activate = (event: Event) => { const fileId = (event as CustomEvent).detail?.fileId; if (fileId) setActiveFileId(fileId) }
        window.addEventListener('ramu:review-file', activate); window.addEventListener('ramu:review-line', activate)
        return () => { window.removeEventListener('ramu:review-file', activate); window.removeEventListener('ramu:review-line', activate) }
    }, [])
    useEffect(() => { if (view.fileId) setActiveFileId(view.fileId) }, [view.fileId, view.requestId])
    useEffect(() => { const fileId = review?.comments.find((c) => c.id === threadTarget)?.fileId; if (fileId) setActiveFileId(fileId) }, [threadTarget, review?.id])
    useEffect(() => { setActiveFileId(null); setShowAll(false) }, [id])
    const reload = useCallback(async () => {
        if (!id) return
        const r = await invoke('reviews.get', id); if (currentId.current !== id) return; setReview(r)
    }, [id])
    useEffect(() => { if (!visible) return; void reload().catch((e) => setError(String(e))); return ramu.on('automation:changed', () => { void reload().catch(() => { }) }) }, [reload, visible])
    useEffect(() => {
        if (!review || !visible) return
        void inspect()
        const refresh = () => { if (document.visibilityState === 'visible') void inspect() }
        const timer = window.setInterval(refresh, 15000)
        window.addEventListener('focus', refresh)
        return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
    }, [review?.id, review?.comments, inspect, visible])
    useEffect(() => { if (!threadTarget || review?.id !== id) return; const frame = requestAnimationFrame(() => { const thread = document.getElementById(`review-thread-${threadTarget}`); const details = thread?.closest('details'); if (details) details.open = true; thread?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }); return () => cancelAnimationFrame(frame) }, [threadTarget, review?.id])
    useEffect(() => { if (review?.id === view.reviewId && view.fileId && !view.threadId) { const frame = requestAnimationFrame(() => { const card = root.current?.querySelector<HTMLElement>(`[data-file-id="${view.fileId}"]`); window.dispatchEvent(new CustomEvent('ramu:review-file', { detail: { fileId: view.fileId } })); card?.scrollIntoView({ block: 'start' }) }); return () => cancelAnimationFrame(frame) } }, [review?.id, view.requestId])
    const act = async (fn: () => Promise<ChangeReview>) => { setBusy(true); setError(null); try { const r = await fn(); if (currentId.current !== r.id) return; setReview(r); return r } catch (e) { setError(String(e)) } finally { setBusy(false) } }
    const revisions = reviews.filter((r) => r.taskId === review?.taskId)
    const differentCheckout = live.some((s) => s.checkoutChanged)
    const files = review?.files ?? []
    const changedLines = useMemo(() => files.reduce((sum, file) => sum + (file.addedLines ?? 0) + (file.removedLines ?? 0), 0), [files])
    const liveById = useMemo(() => new Map(live.map((state) => [state.fileId, state])), [live])
    const commentsByFile = useMemo(() => { const map = new Map<string, ReviewComment[]>(); for (const comment of review?.comments ?? []) if (comment.state === 'draft') { const group = map.get(comment.fileId) ?? []; group.push(comment); map.set(comment.fileId, group) } return map }, [review?.comments])
    const large = files.length > 25 || changedLines > 2500
    const oneAtATime = large && !showAll
    const activeIndex = Math.max(0, files.findIndex((file) => file.id === activeFileId))
    const visibleFiles = oneAtATime && files.length ? [files[activeIndex]!] : files
    // Stepping past a file's last (or first) change continues in the next file with a text diff, wrapping at the ends.
    const filesRef = useRef(files); filesRef.current = files
    useEffect(() => {
        const move = (event: Event) => {
            const { fileId, direction } = (event as CustomEvent).detail ?? {}, all = filesRef.current, from = all.findIndex((file) => file.id === fileId)
            if (from < 0) return
            const step = direction === 'next' ? 1 : -1
            for (let i = 1; i <= all.length; i++) {
                const target = all[(from + step * i % all.length + all.length) % all.length]!
                if (target.binary) continue
                window.dispatchEvent(new CustomEvent('ramu:review-file', { detail: { fileId: target.id } }))
                enterReviewFile(target.id, direction); return
            }
        }
        window.addEventListener('ramu:review-nav-file', move); return () => window.removeEventListener('ramu:review-nav-file', move)
    }, [])
    const pickFile = (fileId: string) => { window.dispatchEvent(new CustomEvent('ramu:review-file', { detail: { fileId } })); if (oneAtATime) { setActiveFileId(fileId); root.current?.scrollTo?.({ top: 0 }) } else root.current?.querySelector<HTMLElement>(`[data-file-id="${fileId}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }
    const openChat = () => { if (review?.sessionId) { ws.openTask(review.taskId); ws.openView(review.taskId, { kind: 'agent', sessionId: review.sessionId }) } }
    return <div ref={root} className="changes-page pair-review changes-tab">
        {!review && <Empty className="automation-empty"><EmptyHeader><EmptyMedia variant="icon"><ClipboardCheck /></EmptyMedia><EmptyTitle>{id && !error ? t("Loading changes…") : t("No changes to review")}</EmptyTitle><EmptyDescription>{t("Changed files will appear here after the agent finishes.")}</EmptyDescription></EmptyHeader>{error && <EmptyContent><p className="error" role="alert">{error}</p></EmptyContent>}</Empty>}
        {review && <>
            <div className="pair-review-bar">
                {revisions.length > 1 ? <Dropdown label={t("Review revision")} disabled={busy} value={review.id} onChange={(value) => openReview(ws, { id: value })} options={revisions.map((r, i) => ({ value: r.id, label: t("{0}Revision {1} · {2}", { "0": i === 0 ? 'Latest · ' : '', "1": revisions.length - i, "2": new Date(r.createdAt).toLocaleString(formatLocale()) }) }))} /> : <span className="muted small">{new Date(review.createdAt).toLocaleString(formatLocale())}</span>}
                <span className="muted small">{review.files.length} {review.files.length === 1 ? 'file' : 'files'}</span><LineStats files={review.files} /><div className="review-layout-toggle" role="group" aria-label={t("Layout for all file diffs")}><Button className="ghost small" aria-pressed={!sideBySide} onClick={() => changeLayout(false)}>{t("Inline")}</Button><Button className="ghost small" aria-pressed={sideBySide} onClick={() => changeLayout(true)}>{t("Split")}</Button></div>
                <span className="review-viewed-progress muted small" role="status">{t("{0} / {1} viewed", { "0": files.filter((file) => viewedFiles.has(file.id)).length, "1": files.length })}</span><span className="grow" />
                <Button className="ghost icon small-icon" disabled={checking} aria-label={t("Check current files")} title={t("Check current files")} onClick={() => void inspect()}><RefreshCw size={13} /></Button>
                <Button className="ghost small" onClick={openChat}>{t("Open chat")}</Button>
            </div>
            {revisions[0] && revisions[0].id !== review.id && <div className="review-newer"><span>{t("You're viewing an earlier revision.")}</span><Button className="ghost small" onClick={() => openReview(ws, { id: revisions[0]!.id })}>{t("View latest changes ")}<ArrowRight size={13} /></Button></div>}
            {(error || review.error) && <p className="error small" role="alert">{error ?? review.error}</p>}
            {liveError && <p className="error small" role="alert">{t("Current files could not be checked: ")}{liveError}</p>}
            {differentCheckout && <div className="review-live-notice" role="status">{t("Viewing a saved revision from a different checkout. Return to the recorded branch before sending feedback or undoing changes. The diff and discussions remain available.")}</div>}
            {review.undoneAt && <p className="muted small">{review.undoFileIds?.length ?? 0} {t(" files undone. This diff shows the original changes.")}</p>}
            <div className="review-split">
                <ReviewFileTree review={review} viewedFiles={viewedFiles} activeId={oneAtATime ? files[activeIndex]?.id : undefined} onPick={pickFile} />
                <div className="review-main">
                    {large && <div className="review-large-banner" role="status"><Info size={15} /><span className="grow">{oneAtATime ? t("This diff is large, showing one file at a time") : t("This diff is large")}</span>
                        {oneAtATime && <><span className="muted small">{activeIndex + 1} / {files.length}</span><Button className="ghost icon small-icon" aria-label={t("Previous file")} disabled={activeIndex === 0} onClick={() => setActiveFileId(files[activeIndex - 1]!.id)}><ChevronLeft size={15} /></Button><Button className="ghost icon small-icon" aria-label={t("Next file")} disabled={activeIndex >= files.length - 1} onClick={() => setActiveFileId(files[activeIndex + 1]!.id)}><ChevronRight size={15} /></Button></>}
                        <Button className="ghost small" onClick={() => setShowAll(!showAll)}>{showAll ? t("One file at a time") : t("Show all files")}</Button></div>}
                    <div className="review-layout"><div className="review-content review-file-stack">{visibleFiles.map((file) => <DeferredReviewFile key={`${review.id}:${file.id}`} file={file} visible={visible}><ReviewFileCard file={file} review={review} viewed={viewedFiles.has(file.id)} onViewed={(viewed) => markViewed(file.id, viewed)} live={liveById.get(file.id)} comments={commentsByFile.get(file.id) ?? []} visible={visible} onInspect={inspect} sideBySide={sideBySide} busy={busy} onAct={act} /></DeferredReviewFile>)}</div></div>
                </div>
            </div>
        </>}
    </div>
}
/** Keep visited cards (and their drafts) alive, but do not construct off-screen card bodies. */
function DeferredReviewFile({ file, visible, children }: { file: ChangeFile; visible: boolean; children: React.ReactNode }) {
    const root = useRef<HTMLDivElement>(null), near = useNearViewport(root, visible)
    const [visited, setVisited] = useState(false), [request, setRequest] = useState<CustomEvent | null>(null)
    useEffect(() => { if (near) setVisited(true) }, [near])
    useEffect(() => {
        if (!visible) return
        if (!revealListeners.size) { window.addEventListener('ramu:review-file', revealFile); window.addEventListener('ramu:review-line', revealFile) }
        const listeners = revealListeners.get(file.id) ?? new Set()
        const reveal = (event: CustomEvent) => { setVisited(true); setRequest(event) }
        listeners.add(reveal); revealListeners.set(file.id, listeners)
        return () => { listeners.delete(reveal); if (!listeners.size) revealListeners.delete(file.id); if (!revealListeners.size) { window.removeEventListener('ramu:review-file', revealFile); window.removeEventListener('ramu:review-line', revealFile) } }
    }, [file.id, visible])
    useEffect(() => { if (visited && request) { window.dispatchEvent(new CustomEvent(request.type, { detail: { ...request.detail, replayed: true } })); setRequest(null) } }, [visited, request])
    return <div ref={root} data-file-id={file.id} className="review-file-slot">{near || visited ? children : <div className="review-file-placeholder" style={{ height: file.binary ? 100 : 350 }}><span className="muted small">{file.path}</span></div>}</div>
}
function ReviewFileCard({ file, review, live, comments, visible, onInspect, sideBySide, busy, onAct, viewed, onViewed }: { viewed: boolean; onViewed: (viewed: boolean) => void; file: ChangeFile; review: ChangeReview; live?: ReviewFileState; onInspect: () => Promise<void>; sideBySide: boolean; busy: boolean; onAct: (fn: () => Promise<ChangeReview>) => Promise<ChangeReview | undefined>; comments: ReviewComment[]; visible: boolean }) {
    useLanguage()
    const ws = useWorkspace()
    const [collapsed, setCollapsed] = useState(viewed), [composerOpen, setComposerOpen] = useState(false), [draftError, setDraftError] = useState<string | null>(null)
    const [comparison, setComparison] = useState<ChangeFile | null>(null), [showComparison, setShowComparison] = useState(false), [liveBusy, setLiveBusy] = useState(false), [actionError, setActionError] = useState<string | null>(null)
    const [locating, setLocating] = useState(false), [locatedPath, setLocatedPath] = useState('')
    const compare = async () => { if (showComparison) { setShowComparison(false); return } setLiveBusy(true); setActionError(null); try { setComparison(await invoke('reviews.compareCurrent', review.id, file.id)); setShowComparison(true); setCollapsed(false) } catch (e) { setActionError(String(e)) } finally { setLiveBusy(false) } }
    const locate = async () => { setLiveBusy(true); setActionError(null); try { await invoke('reviews.locate', review.id, file.id, locatedPath.trim()); setLocating(false); setShowComparison(false); await onInspect() } catch (e) { setActionError(String(e)) } finally { setLiveBusy(false) } }
    const [location, setLocation] = useReviewDraft<{ side: 'old' | 'new'; line: number; endLine: number; scope: 'file' | 'line' }>(`${review.id}:${file.id}:location`, { side: 'new', line: 1, endLine: 1, scope: 'file' })
    const [draft, setDraft] = useReviewDraft(`${review.id}:${file.id}:text`, ''), [editing, setEditing] = useReviewDraft<string | null>(`${review.id}:${file.id}:editing`, null)
    const draftRef = useRef<HTMLTextAreaElement>(null)
    useEffect(() => {
        const reveal = (event: Event) => { if ((event as CustomEvent).detail?.fileId === file.id) setCollapsed(false) }
        window.addEventListener('ramu:review-file', reveal); window.addEventListener('ramu:review-line', reveal)
        return () => { window.removeEventListener('ramu:review-file', reveal); window.removeEventListener('ramu:review-line', reveal) }
    }, [file.id])
    // Comments leave the diff once they are sent with a chat message.
    const startComment = (side: 'old' | 'new', line: number, endLine: number, scope: 'file' | 'line' = 'line') => {
        if (draft.trim() && (location.side !== side || location.line !== line || location.endLine !== endLine || location.scope !== scope)) { setDraftError('Add or cancel your current draft before starting another comment.'); draftRef.current?.focus(); return }
        setLocation({ side, line, endLine, scope }); setComposerOpen(true); setCollapsed(false); setDraftError(null)
        requestAnimationFrame(() => { draftRef.current?.scrollIntoView({ block: 'nearest' }); draftRef.current?.focus() })
    }
    const editComment = (comment: ReviewComment) => { if (draft.trim() && editing !== comment.id) { setDraftError('Add or cancel your current draft first.'); return } setEditing(comment.id); setLocation({ side: comment.side, line: comment.line, endLine: comment.endLine, scope: comment.scope ?? 'line' }); setDraft(comment.text); setComposerOpen(true); setCollapsed(false); requestAnimationFrame(() => draftRef.current?.focus()) }
    const save = async () => { const result = await onAct(() => invoke('reviews.comment', review.id, { fileId: file.id, ...location, text: draft }, editing ?? undefined)); if (result) { setDraft(''); setEditing(null); setComposerOpen(false); setDraftError(null) } }
    const renderThread = (comment: ReviewComment) => <ReviewThread key={comment.id} review={review} comment={comment} busy={busy} onEdit={() => editComment(comment)} onAct={onAct} />
    const where = location.scope === 'file' ? 'File' : `${location.side === 'old' ? 'L' : 'R'}${location.line}${location.endLine !== location.line ? `–${location.side === 'old' ? 'L' : 'R'}${location.endLine}` : ''}`
    const composer = <div className="review-comment-composer review-note editing"><header><span className="review-note-where">{where}</span><span className="muted small">{editing ? t("Editing comment") : t("New comment")}</span></header><Textarea ref={draftRef} aria-label={t("Comment on {0}", { "0": file.path })} rows={2} maxLength={10000} placeholder={t("What should change, or what would you like to ask?")} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && draft.trim() && !busy) { event.preventDefault(); void save() } if (event.key === 'Escape') { setComposerOpen(false); setEditing(null); setDraft(''); setDraftError(null) } }} />{draftError && <p className="error small" role="alert">{draftError}</p>}<div className="review-composer-actions"><Button className="primary small" disabled={busy || !draft.trim()} onClick={() => void save()}>{editing ? t("Save") : t("Comment")}</Button><Button className="ghost small" disabled={busy} onClick={() => { setComposerOpen(false); setEditing(null); setDraft(''); setDraftError(null) }}>{t("Cancel")}</Button><span className="grow" /><span className="muted small">{t("⌘↵ to save")}</span></div></div>
    const showComposer = composerOpen || !!draft.trim() || !!editing
    const groups = new Map<string, ReviewComment[]>()
    for (const comment of comments.filter((comment) => comment.scope !== 'file' && comment.state !== 'resolved')) { const key = `${comment.side}:${comment.endLine}`; groups.set(key, [...(groups.get(key) ?? []), comment]) }
    const inlineBlocks: InlineReviewBlock[] = [...groups].map(([key, threads]) => ({ key, side: threads[0]!.side, line: threads[0]!.endLine, content: <div className="review-inline-threads">{threads.map(renderThread)}</div> }))
    if (showComposer && location.scope !== 'file') inlineBlocks.push({ key: 'draft', side: location.side, line: location.endLine, content: composer })
    const fileComments = comments.filter((comment) => comment.scope === 'file' && comment.state !== 'resolved'), resolved = comments.filter((comment) => comment.state === 'resolved')
    const liveNote = live && (live.state !== 'unchanged' && live.state !== 'deleted' || live.checkoutChanged)
        ? live.checkoutChanged ? 'Different checkout' : live.state === 'changed' ? 'Changed since this run' : live.state === 'moved' ? 'File moved' : live.state === 'missing' ? 'File missing' : 'File unavailable' : ''
    const liveDetail = !live ? '' : live.checkoutChanged ? `Recorded on ${live.recordedBranch ?? 'unknown'}, current ${live.currentBranch ?? 'unavailable'}` : live.state === 'moved' ? live.currentPath : live.reason ?? 'This diff shows the saved run. Current code may include later changes.'
    return <section id={`review-file-${review.id}-${file.id}`} data-file-id={file.id} className={`review-file-card${viewed ? ' viewed' : ''}`} aria-label={t("Changes to {0}", { "0": file.path })}><header className="review-file-heading"><Button className="ghost icon small-icon" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</Button><div className="review-file-path" title={`${file.repoName} · ${file.path}`}><span className="review-file-title"><span className="muted">{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''}</span>{file.path.slice(file.path.lastIndexOf('/') + 1)}</span></div><LineStats files={[file]} />{comments.filter((c) => c.state !== 'resolved').length > 0 && <span className="review-discussion-count" title={t("Open discussions")} aria-label={t("{0} open discussions", { "0": comments.filter((c) => c.state !== 'resolved').length })}>{comments.filter((c) => c.state !== 'resolved').length}</span>}{liveNote && <span className={`review-live-chip${live?.state === 'missing' || live?.checkoutChanged ? ' warn' : ''}`} title={liveDetail}>{liveNote}</span>}<span className="grow" />{live?.newerReview && <Button className="ghost small" onClick={() => openReview(ws, { id: live.newerReview!.id, fileId: live.newerReview!.fileId })}>{live.newerReview.taskId === review.taskId ? t("Later revision") : t("Changes in {0}", { "0": ws.task(live.newerReview.taskId)?.title ?? t('another chat') })}<ArrowRight size={13} /></Button>}{live?.currentPath && !file.binary && <Button className="ghost small" disabled={liveBusy} aria-expanded={showComparison} onClick={() => void compare()}>{showComparison ? t("Hide comparison") : t("Compare current")}</Button>}{live?.state === 'missing' && <Button className="ghost small" disabled={liveBusy} aria-expanded={locating} onClick={() => setLocating(!locating)}>{t("Locate file")}</Button>}{!file.binary && <>
        <Button className="ghost icon small-icon" aria-label={t("Previous change")} title={t("Previous change")} onClick={() => window.dispatchEvent(new CustomEvent('ramu:review-nav', { detail: { fileId: file.id, direction: 'previous' } }))}><ChevronUp size={14} /></Button>
        <Button className="ghost icon small-icon" aria-label={t("Next change")} title={t("Next change")} onClick={() => window.dispatchEvent(new CustomEvent('ramu:review-nav', { detail: { fileId: file.id, direction: 'next' } }))}><ChevronDown size={14} /></Button>
    </>}
        <Button variant="ghost" size="sm" className="review-file-comment" aria-label={t("File comment")} disabled={busy} onClick={() => startComment('new', 1, 1, 'file')}><MessageSquarePlus size={14} /></Button>
        <label className="review-viewed"><Checkbox checked={viewed} aria-labelledby={`review-viewed-${review.id}-${file.id}`} onCheckedChange={(checked) => { onViewed(checked); setCollapsed(checked && !showComposer); if (checked) setShowComparison(false) }} /><span id={`review-viewed-${review.id}-${file.id}`} className="sr-only">{t("Mark {0} as viewed", { "0": file.path })}</span><span aria-hidden="true">{t("Viewed")}</span></label>
        <Button className="ghost icon small-icon" aria-label={t("Open {0} in editor", { "0": live?.currentPath ?? file.path })} title={live?.currentPath ? t("Open current file in editor") : t("Current file unavailable")} disabled={!live?.currentPath} onClick={() => { if (live?.currentPath) { ws.openTask(review.taskId); ws.openView(review.taskId, { kind: 'file', repoId: file.repoId, path: live.currentPath }) } }}><ExternalLink size={14} /></Button></header>
        {locating && <form className="review-locate" onSubmit={(e) => { e.preventDefault(); void locate() }}><label htmlFor={`locate-${file.id}`} className="small">{t("Current path relative to ")}{file.repoName}</label><Input id={`locate-${file.id}`} value={locatedPath} placeholder="src/new-location.ts" onChange={(e) => setLocatedPath(e.target.value)} /><Button className="primary small" disabled={liveBusy || !locatedPath.trim()} type="submit">{t("Use this file")}</Button><Button type="button" className="ghost small" onClick={() => setLocating(false)}>{t("Cancel")}</Button><p className="muted small">{t("Links the current file. Saved code and comment locations stay unchanged.")}</p></form>}
        {actionError && <p className="error small review-live-error" role="alert">{actionError}</p>}
        {showComparison && comparison && <div className="review-current-comparison"><div className="muted small">{t("Recorded result → current file · read-only comparison")}</div><ReviewDiff visible={visible} key={`${comparison.newHash}:${comparison.path}`} file={comparison} comments={[]} sideBySide={sideBySide} flow onSelect={() => { }} /></div>}
        {!collapsed && <>{file.binary ? <p className="review-binary muted">{t("This binary or large file has no text diff.")}</p> : <ReviewDiff visible={visible} file={file} comments={comments} sideBySide={sideBySide} flow onSelect={() => { }} onComment={(side, line, endLine) => startComment(side, line, endLine)} inlineBlocks={inlineBlocks} />}
            {(fileComments.length > 0 || showComposer && location.scope === 'file' || resolved.length > 0) && <div className="review-file-discussion">{showComposer && location.scope === 'file' && composer}{fileComments.map(renderThread)}{resolved.length > 0 && <Collapsible className="review-resolved"><CollapsibleTrigger render={<Button variant="ghost" />}>{t("Resolved discussions · ")}{resolved.length}</CollapsibleTrigger><CollapsibleContent>{resolved.map(renderThread)}</CollapsibleContent></Collapsible>}</div>}</>}
    </section>
}
function ReviewThread({ review, comment, onEdit, busy, onAct }: { review: ChangeReview; comment: ReviewComment; busy: boolean; onEdit: () => void; onAct: (fn: () => Promise<ChangeReview>) => Promise<ChangeReview | undefined> }) {
    useLanguage()
    const side = comment.side === 'old' ? 'L' : 'R'
    const where = comment.scope === 'file' ? 'File' : `${side}${comment.line}${comment.endLine !== comment.line ? `–${side}${comment.endLine}` : ''}`
    const goTo = () => window.dispatchEvent(new CustomEvent('ramu:review-line', { detail: { fileId: comment.fileId, side: comment.side, line: comment.line, endLine: comment.endLine } }))
    return <article id={`review-thread-${comment.id}`} className={`review-note ${comment.author}`}>
        <header>
            <Button type="button" className="review-note-where" title={t("Show these lines")} onClick={goTo}>{where}</Button>
            <span className="muted small">{comment.author === 'ai' ? t("AI note") : t("Your comment")}</span>
            <span className="grow" />
            <span className="review-note-actions">
                {comment.author === 'human' && <Button className="ghost icon small-icon" disabled={busy} aria-label={t("Edit comment")} title="Edit" onClick={onEdit}><Pencil size={13} /></Button>}
                <Button className="ghost icon small-icon" disabled={busy} aria-label={t("Delete comment")} title={t("Delete")} onClick={() => void onAct(() => invoke('reviews.removeComment', review.id, comment.id))}><Trash2 size={13} /></Button>
            </span>
        </header>
        <p>{comment.text}</p>
    </article>
}

/** File list beside the diffs: click to jump to a file, or to open it when the diff is shown one file at a time. */
function ReviewFileTree({ review, activeId, onPick, viewedFiles }: { viewedFiles: Set<string>; review: ChangeReview; activeId?: string; onPick: (fileId: string) => void }) {
    useLanguage()
    const [filter, setFilter] = useState(''), [closed, setClosed] = useState<Set<string>>(new Set())
    type Node = { name: string; path: string; dirs: Map<string, Node>; files: ChangeFile[] }
    const { preferences } = useAppSettings()
    const needle = useDeferredValue(filter).trim().toLowerCase()
    const tree = useMemo(() => {
        const root: Node = { name: '', path: '', dirs: new Map(), files: [] }
        for (const file of review.files) {
            if (needle && !file.path.toLowerCase().includes(needle)) continue
            const parts = file.path.split('/'); let node = root
            for (const part of parts.slice(0, -1)) { const path = node.path ? `${node.path}/${part}` : part; if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path, dirs: new Map(), files: [] }); node = node.dirs.get(part)! }
            node.files.push(file)
        }
        return root
    }, [review.files, needle])
    const counts = useMemo(() => { const map = new Map<string, number>(); for (const comment of review.comments) if (comment.state === 'draft') map.set(comment.fileId, (map.get(comment.fileId) ?? 0) + 1); return map }, [review.comments])
    type Row = { key: string; depth: number; dir: Node; open: boolean } | { key: string; depth: number; file: ChangeFile }
    const rows = useMemo(() => {
        const result: Row[] = []
        const visit = (node: Node, depth: number) => {
            for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
                const open = !!needle || !closed.has(dir.path)
                result.push({ key: `dir:${dir.path}`, depth, dir, open })
                if (open) visit(dir, depth + 1)
            }
            for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) result.push({ key: `file:${file.id}`, depth, file })
        }
        visit(tree, 0); return result
    }, [tree, closed, needle])
    const render = (row: Row) => 'dir' in row
        ? <Button type="button" className="review-tree-row dir" style={{ paddingLeft: 8 + row.depth * 12 }} aria-expanded={row.open} onClick={() => setClosed((current) => { const next = new Set(current); next.has(row.dir.path) ? next.delete(row.dir.path) : next.add(row.dir.path); return next })}>{row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="review-tree-name">{row.dir.name}</span></Button>
        : <Button type="button" className={`review-tree-row file${activeId === row.file.id ? ' active' : ''}`} style={{ paddingLeft: 8 + row.depth * 12 + 17 }} title={row.file.path} onClick={() => onPick(row.file.id)}>
            <span className="review-tree-name">{row.file.path.slice(row.file.path.lastIndexOf('/') + 1)}</span>
            {viewedFiles.has(row.file.id) && <Check size={13} className="review-tree-viewed" aria-label={t("Viewed")} />}
            {counts.get(row.file.id) ? <span className="review-discussion-count">{counts.get(row.file.id)}</span> : null}
            {!row.file.binary && row.file.addedLines !== undefined && <span className="review-tree-stat"><span className="lines-added">+{row.file.addedLines}</span>{!!row.file.removedLines && <span className="lines-removed">−{row.file.removedLines}</span>}</span>}
        </Button>
    return <aside className="review-tree" aria-label={t("Changed files")}>
        <SearchInput className="review-tree-filter" aria-label={t("Filter files")} placeholder={t("Filter files…")} value={filter} onChange={(event) => setFilter(event.target.value)} onClear={() => setFilter('')} />
        <VirtualList items={rows} rowHeight={Math.max(27, preferences.fontSize + 12)} itemKey={(row) => row.key} renderItem={render} className="review-tree-list" resetKey={needle} revealKey={activeId ? `file:${activeId}` : undefined} />
    </aside>
}

export function SessionChangesButton({ sessionId }: { sessionId: string }) {
    useLanguage()
    const ws = useWorkspace(), { reviews } = useReviews(), review = reviews.find((r) => r.sessionId === sessionId && r.files.length > 0)
    // Only chats that changed files get a review to open.
    if (!review || !review.files.length) return null
    return <Button className="ghost small" onClick={() => { openReview(ws, { id: review.id, taskId: review.taskId }) }}><ClipboardCheck size={13} />{t("Changes · ")}{review.files.length}</Button>
}

export const TurnChanges = memo(function TurnChanges({ review }: { review: ChangeReview }) {
    useLanguage()
    const ws = useWorkspace(), { preferences } = useAppSettings()
    const [expanded, setExpanded] = useState(false)
    const commentCounts = useMemo(() => { const map = new Map<string, number>(); for (const comment of review.comments) if (comment.state !== 'resolved') map.set(comment.fileId, (map.get(comment.fileId) ?? 0) + 1); return map }, [review.comments])
    if (!review.files.length) return null
    const single = review.files.length === 1
    const visible = expanded ? review.files : review.files.slice(0, 3)
    const undone = review.files.every((file) => review.undoFileIds?.includes(file.id))
    const manyRepos = new Set(review.files.map((file) => file.repoId)).size > 1
    const renderFile = (file: ChangeFile) => {
        const slash = file.path.lastIndexOf('/')
        return <Button variant="ghost" className="chat-change-file" title={`${file.repoName}/${file.path}`} onClick={() => openReview(ws, { id: review.id, taskId: review.taskId, fileId: file.id })}>
            <span className="chat-change-path">{manyRepos && <span className="muted">{file.repoName}/</span>}{slash >= 0 && <span className="muted">{file.path.slice(0, slash + 1)}</span>}<span>{file.path.slice(slash + 1)}</span></span>
            <LineStats files={[file]} />{file.binary && <span className="muted small">{t("Binary")}</span>}
            {!!commentCounts.get(file.id) && <span className="review-discussion-count" title={t("Open discussions")}>{commentCounts.get(file.id)}</span>}
        </Button>
    }
    return <section className="chat-changes" aria-label={t("Files changed in this turn")}>
        <div className="chat-changes-heading">
            <span className="chat-changes-icon" aria-hidden="true"><FileDiff size={21} strokeWidth={1.6} /></span>
            <div className="chat-changes-summary"><strong title={single ? review.files[0]!.path : undefined}>{single ? t('Edited {0}', { '0': review.files[0]!.path.split('/').pop()! }) : t('Edited {0} files', { '0': review.files.length })}</strong><LineStats files={review.files} />{undone && <span className="muted small">{t('Changes undone')}</span>}</div>
            <div className="chat-changes-actions"><UndoReview reviewId={review.id} disabled={undone || review.state !== 'ready'} /><Button variant="outline" className="small" onClick={() => openReview(ws, { id: review.id, taskId: review.taskId })}>{t("View changes")}</Button></div>
        </div>
        {!single && (expanded && review.files.length > 100
            ? <VirtualList items={review.files} rowHeight={Math.max(38, preferences.fontSize + 24)} itemKey={(file) => file.id} renderItem={renderFile} className="chat-change-list" />
            : <ul>{visible.map((file) => <li key={file.id}>{renderFile(file)}</li>)}</ul>)}
        {!single && review.files.length > 3 && <Button variant="ghost" className="chat-changes-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? t('Show fewer files') : t('Show {0} more files', { '0': review.files.length - 3 })}<ChevronDown size={14} className={expanded ? 'expanded' : ''} /></Button>}
    </section>
})
