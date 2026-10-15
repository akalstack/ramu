import { ExpandRow } from '@/components/expand-row'
import { errorText } from './errors'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { ContentSkeleton } from '@/components/content-skeleton'
import { t, useLanguage, formatLocale, currentLanguage } from './i18n'
import { formatChatDate } from '@ramu/shared/chatDates'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dropdown } from './Menu'
import { SearchInput } from './SearchInput'
import { useReviewDraft } from './reviewDrafts'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns2, FileDiff, ExternalLink, Info, MessageSquare, MessageSquarePlus, PanelLeft, Pencil, Rows2, Trash2 } from 'lucide-react'
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeFile, ChangeReview, ReviewComment, ReviewBranchState, ViewDescriptor } from '@ramu/shared/types'
import { invoke, ramu } from './ipc'
import { useWorkspace } from './workspace'
import { ReviewDiff, enterReviewFile, type InlineReviewBlock } from './ReviewDiff'
import { UndoReview } from './UndoRun'
import { LineStats } from './LineStats'
import { useReviews, openReview } from './reviews'
import { VirtualList } from './VirtualList'
import { useAppSettings } from './AppSettings'
import { useNearViewport } from './useNearViewport'
import { commentLabel } from './ReviewChip'
import { useHostConnection } from './computers'
import { formatKeys } from './commands'

const NARROW_REVIEW = 720
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
  const [branches, setBranches] = useState<ReviewBranchState[]>([]), [branchError, setBranchError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  // A docked pane is too narrow for split diffs and a file tree beside them: diffs go inline (the saved choice is kept) and the tree folds away.
  const [narrow, setNarrow] = useState(false)
  const [treeOpen, setTreeOpen] = useState(() => { try { return localStorage.getItem('ramu.review-tree') !== 'closed' } catch { return true } }), [narrowTree, setNarrowTree] = useState(false)
  const showTree = narrow ? narrowTree : treeOpen
  const toggleTree = () => { if (narrow) { setNarrowTree(!narrowTree); return } setTreeOpen(!treeOpen); try { localStorage.setItem('ramu.review-tree', treeOpen ? 'closed' : 'open') } catch { } }
  const split = sideBySide && !narrow
  useEffect(() => {
    const page = root.current, bar = page?.querySelector<HTMLElement>('.pair-review-bar')
    if (!page || !bar) return
    let previousHeight = -1
    const measure = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height)
      if (height !== previousHeight) { previousHeight = height; page.style.setProperty('--review-toolbar-height', `${height}px`) }
      setNarrow(page.clientWidth < NARROW_REVIEW)
    }
    const observer = new ResizeObserver(measure); observer.observe(bar); measure()
    return () => observer.disconnect()
  }, [review?.id])
  const currentId = useRef(id); currentId.current = id
  useEffect(() => { setReview(null); setError(null); setBranches([]); setBranchError(null) }, [id])
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
  useEffect(() => { if (!visible) return; void reload().catch((e) => setError(errorText(e))); return ramu.on('automation:changed', () => { void reload().catch(() => { }) }) }, [reload, visible])
  useEffect(() => {
    if (!review || !visible) return
    let disposed = false, request = 0
    const refresh = async () => {
      const seq = ++request
      try { const next = await invoke('reviews.branches', id); if (!disposed && seq === request) { setBranches(next); setBranchError(null) } }
      catch (reason) { if (!disposed && seq === request) setBranchError(errorText(reason)) }
    }
    void refresh()
    const timer = window.setInterval(() => { if (!document.documentElement.hasAttribute('data-workspace-hidden') && document.visibilityState === 'visible') void refresh() }, 15000)
    window.addEventListener('focus', refresh)
    const off = ramu.on('fs:changed', ({ path }) => { if (path === '.git/HEAD') void refresh() })
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', refresh); off() }
  }, [review?.id, id, visible])
  useEffect(() => { if (!threadTarget || review?.id !== id) return; const frame = requestAnimationFrame(() => { const thread = document.getElementById(`review-thread-${threadTarget}`); const details = thread?.closest('details'); if (details) details.open = true; thread?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }); return () => cancelAnimationFrame(frame) }, [threadTarget, review?.id])
  useEffect(() => { if (review?.id === view.reviewId && view.fileId && !view.threadId) { const frame = requestAnimationFrame(() => { const card = root.current?.querySelector<HTMLElement>(`[data-file-id="${view.fileId}"]`); window.dispatchEvent(new CustomEvent('ramu:review-file', { detail: { fileId: view.fileId } })); card?.scrollIntoView({ block: 'start' }) }); return () => cancelAnimationFrame(frame) } }, [review?.id, view.requestId])
  const act = async (fn: () => Promise<ChangeReview>) => { setBusy(true); setError(null); try { const r = await fn(); if (currentId.current !== r.id) return; setReview(r); return r } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  const revisions = reviews.filter((r) => r.taskId === review?.taskId)
  const files = review?.files ?? []
  const changedLines = useMemo(() => files.reduce((sum, file) => sum + (file.addedLines ?? 0) + (file.removedLines ?? 0), 0), [files])
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
  return <OverlayScrollArea className="h-full flex-1 min-w-0 w-full isolate [container-type:inline-size]" viewportClassName="changes-page pair-review changes-tab h-full" viewportRef={root} contentClassName="flex flex-col gap-2 p-[0_8px_12px] min-h-full [--review-page-padding-top:0px]">
    {!review && id && !error && <ContentSkeleton variant="cards" rows={3} label={t("Loading changes…")} />}
    {!review && (!id || error) && <Empty className="automation-empty"><EmptyHeader><EmptyMedia variant="icon"><FileDiff /></EmptyMedia><EmptyTitle>{id && !error ? t("Loading changes…") : t("No changes to review")}</EmptyTitle><EmptyDescription>{t("Changed files will appear here after the agent finishes.")}</EmptyDescription></EmptyHeader>{error && <EmptyContent><p className="error text-bad" role="alert">{error}</p></EmptyContent>}</Empty>}
    {review && <>
      <div className="pair-review-bar sticky top-0 z-20 m-[0_-8px] bg-canvas [border-bottom:var(--pane-border-width)_solid_var(--pane-border-color)]">
        <div className="review-branch-context flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-caption text-muted-foreground [border-bottom:1px_solid_var(--line)]" aria-label={t("Snapshot branch context")}>
          <span>{t("Run snapshot")}</span>
          {branches.map((branch) => <div key={branch.repoId} className="flex min-w-0 flex-wrap items-center gap-1.5">
            {branches.length > 1 && <strong className="font-medium text-foreground">{branch.repoName}</strong>}
            <span>{t("Current")}</span><span className="max-w-48 truncate text-foreground" title={branch.currentBranch ?? undefined}>{branch.currentBranch ?? t("No branch")}</span>
            <ArrowRight size={12} className="shrink-0" />
            <span>{t("Target")}</span><span className="max-w-48 truncate text-foreground" title={branch.targetBranch ?? undefined}>{branch.targetBranch ?? t("No target")}</span>
            {branch.recordedBranch && branch.recordedBranch !== branch.currentBranch && <span className="min-w-0 truncate" title={branch.recordedBranch}>{t("Recorded on {0}", { "0": branch.recordedBranch })}</span>}
          </div>)}
          {branchError && <span role="status" title={branchError}>{t("Branch context unavailable")}</span>}
        </div>
      <div className="review-toolbar [&_>_*]:flex-none [&_>_.grow]:flex-1 [&_>_.grow]:min-w-1 [&_button.small-icon]:text-muted-foreground [&_button.small-icon]:rounded-(--radius-s) [&_button.small-icon:hover:not(:disabled)]:text-foreground [&_button.small-icon[aria-pressed='true']]:text-foreground [&_.review-layout-toggle_button.small-icon]:w-6 [&_.review-layout-toggle_button.small-icon]:h-6 [&_.review-layout-toggle_button.small-icon]:rounded-(--radius-xs) [&_.review-layout-toggle_button.small-icon[aria-pressed='true']]:bg-raised [&_.review-layout-toggle_button.small-icon[aria-pressed='true']]:text-foreground [&_.review-layout-toggle_button.small-icon[aria-pressed='true']]:[box-shadow:0_1px_2px_rgba(0,_0,_0,_0.2)] flex items-center gap-1 min-h-[40px] p-[0_8px] whitespace-nowrap overflow-hidden">
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-pressed={showTree} aria-label={showTree ? t("Hide file tree") : t("Show file tree")} title={showTree ? t("Hide file tree") : t("Show file tree")} onClick={toggleTree}><PanelLeft size={14} /></Button>
        <span className="review-bar-summary [&_strong]:font-medium inline-flex items-center gap-2 ml-1 text-control"><strong>{review.files.length === 1 ? t("1 file") : t("{0} files", { "0": review.files.length })}</strong><LineStats files={review.files} /></span>
        {revisions.length > 1 ? <Dropdown label={t("Review revision")} className="shrink! min-w-0! max-w-[min(100%,260px)] overflow-hidden" disabled={busy} value={review.id} onChange={(value) => openReview(ws, { id: value })} options={revisions.map((r, i) => ({ value: r.id, label: t("{0}Revision {1} · {2}", { "0": i === 0 ? 'Latest · ' : '', "1": revisions.length - i, "2": formatChatDate(r.createdAt, Date.now(), currentLanguage()) }) }))} /> : <time className="review-bar-date text-muted-foreground text-caption tabular-nums ml-1.5" dateTime={new Date(review.createdAt).toISOString()} title={new Date(review.createdAt).toLocaleString(formatLocale())}>{formatChatDate(review.createdAt, Date.now(), currentLanguage())}</time>}
        <span className="grow flex-1 min-w-0 text-left" />
        <span className="review-viewed-progress whitespace-nowrap text-muted-foreground text-caption tabular-nums mr-1.5" role="status">{t("{0} / {1} viewed", { "0": files.filter((file) => viewedFiles.has(file.id)).length, "1": files.length })}</span>
        <div className="review-layout-toggle inline-flex gap-0.5 p-0.5 rounded-(--radius-s) bg-fill" role="group" aria-label={t("Layout for all file diffs")}>
          <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-pressed={!split} aria-label={t("Inline")} title={t("Inline")} onClick={() => changeLayout(false)}><Rows2 size={14} /></Button>
          <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-pressed={split} disabled={narrow} aria-label={t("Split")} title={narrow ? t("Split needs a wider pane") : t("Split")} onClick={() => changeLayout(true)}><Columns2 size={14} /></Button>
        </div>
        {review.sessionId && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Open chat")} title={t("Open chat")} onClick={openChat}><MessageSquare size={14} /></Button>}
      </div>
      </div>
      {revisions[0] && revisions[0].id !== review.id && <div className="review-newer flex items-center justify-between gap-3 bg-brand-wash rounded-(--radius-s) p-[6px_12px] text-caption"><span>{t("You're viewing an earlier revision.")}</span><Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" onClick={() => openReview(ws, { id: revisions[0]!.id })}>{t("View latest changes ")}<ArrowRight size={13} /></Button></div>}
      {(error || review.error) && <p className="error text-bad small text-caption" role="alert">{error ?? review.error}</p>}
      {review.undoneAt && <p className="muted text-muted-foreground small text-caption">{review.undoFileIds?.length ?? 0} {t(" files undone. This diff shows the original changes.")}</p>}
      <div className={`review-split [&.no-tree]:[grid-template-columns:minmax(0,_1fr)] grid [grid-template-columns:clamp(160px,_20cqw,_240px)_minmax(0,_1fr)] gap-2 [align-items:start] ${showTree ? '' : ' no-tree'}`}>
        {showTree && <ReviewFileTree review={review} viewedFiles={viewedFiles} activeId={oneAtATime ? files[activeIndex]?.id : undefined} onPick={(fileId) => { pickFile(fileId); if (narrow) setNarrowTree(false) }} />}
        <div className="review-main min-w-0 flex flex-col gap-2">
          {large && <div className="review-large-banner [&_>_svg:first-child]:text-brand [&_>_svg:first-child]:flex-none flex items-center gap-2 p-[8px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised text-soft text-control" role="status"><Info size={15} /><span className="grow flex-1 min-w-0 text-left">{oneAtATime ? t("This diff is large, showing one file at a time") : t("This diff is large")}</span>
            {oneAtATime && <><span className="muted text-muted-foreground small text-caption">{activeIndex + 1} / {files.length}</span><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Previous file")} disabled={activeIndex === 0} onClick={() => setActiveFileId(files[activeIndex - 1]!.id)}><ChevronLeft size={15} /></Button><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Next file")} disabled={activeIndex >= files.length - 1} onClick={() => setActiveFileId(files[activeIndex + 1]!.id)}><ChevronRight size={15} /></Button></>}
            <Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" onClick={() => setShowAll(!showAll)}>{showAll ? t("One file at a time") : t("Show all files")}</Button></div>}
          <div className="review-file-stack flex flex-col gap-2">{visibleFiles.map((file) => <DeferredReviewFile key={`${review.id}:${file.id}`} file={file} visible={visible}><ReviewFileCard file={file} review={review} viewed={viewedFiles.has(file.id)} onViewed={(viewed) => markViewed(file.id, viewed)} comments={commentsByFile.get(file.id) ?? []} visible={visible} sideBySide={split} busy={busy} onAct={act} /></DeferredReviewFile>)}</div>
        </div>
      </div>
    </>}
  </OverlayScrollArea>
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
  return <div ref={root} data-file-id={file.id} className="review-file-slot min-w-0">{near || visited ? children : <div className="review-file-placeholder p-3 rounded-(--radius-m) bg-fill" style={{ height: file.binary ? 100 : 350 }}><span className="muted text-muted-foreground small text-caption">{file.path}</span></div>}</div>
}
function ReviewFileCard({ file, review, comments, visible, sideBySide, busy, onAct, viewed, onViewed }: { viewed: boolean; onViewed: (viewed: boolean) => void; file: ChangeFile; review: ChangeReview; sideBySide: boolean; busy: boolean; onAct: (fn: () => Promise<ChangeReview>) => Promise<ChangeReview | undefined>; comments: ReviewComment[]; visible: boolean }) {
  useLanguage()
  const ws = useWorkspace()
  const [collapsed, setCollapsed] = useState(viewed), [composerOpen, setComposerOpen] = useState(false), [draftError, setDraftError] = useState<string | null>(null)
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
    if (draft.trim() && (location.side !== side || location.line !== line || location.endLine !== endLine || location.scope !== scope)) { setDraftError(t('Add or cancel your current draft before starting another comment.')); draftRef.current?.focus(); return }
    setLocation({ side, line, endLine, scope }); setComposerOpen(true); setCollapsed(false); setDraftError(null)
    requestAnimationFrame(() => { draftRef.current?.scrollIntoView({ block: 'nearest' }); draftRef.current?.focus() })
  }
  const editComment = (comment: ReviewComment) => { if (draft.trim() && editing !== comment.id) { setDraftError(t('Add or cancel your current draft first.')); return } setEditing(comment.id); setLocation({ side: comment.side, line: comment.line, endLine: comment.endLine, scope: comment.scope ?? 'line' }); setDraft(comment.text); setComposerOpen(true); setCollapsed(false); setDraftError(null); requestAnimationFrame(() => { draftRef.current?.scrollIntoView({ block: 'nearest' }); draftRef.current?.focus() }) }
  const save = async () => { const result = await onAct(() => invoke('reviews.comment', review.id, { fileId: file.id, ...location, text: draft }, editing ?? undefined)); if (result) { setDraft(''); setEditing(null); setComposerOpen(false); setDraftError(null) } }
  // An edited comment turns into the form where it stands, as a chat message does.
  const renderThread = (comment: ReviewComment) => comment.id === editing ? composer : <ReviewThread key={comment.id} review={review} comment={comment} busy={busy} onEdit={() => editComment(comment)} onAct={onAct} />
  const original = editing ? comments.find((comment) => comment.id === editing)?.text : undefined
  const cancel = () => { setComposerOpen(false); setEditing(null); setDraft(''); setDraftError(null) }
  const composer = <CommentForm key="comment-form" inputRef={draftRef} path={file.path} where={commentLabel(location.side, location.line, location.endLine, location.scope)} editing={!!editing} value={draft} unchanged={original !== undefined && draft.trim() === original.trim()} error={draftError} busy={busy} onChange={setDraft} onCancel={cancel} onSave={() => void save()} />
  const showComposer = composerOpen || !!draft.trim() || !!editing
  const groups = new Map<string, ReviewComment[]>()
  for (const comment of comments.filter((comment) => comment.scope !== 'file' && comment.state !== 'resolved')) { const key = `${comment.side}:${comment.endLine}`; groups.set(key, [...(groups.get(key) ?? []), comment]) }
  const inlineBlocks: InlineReviewBlock[] = [...groups].map(([key, threads]) => ({ key, side: threads[0]!.side, line: threads[0]!.endLine, content: <div className="review-inline-threads">{threads.map(renderThread)}</div> }))
  if (showComposer && !editing && location.scope !== 'file') inlineBlocks.push({ key: 'draft', side: location.side, line: location.endLine, content: composer })
  const fileComments = comments.filter((comment) => comment.scope === 'file' && comment.state !== 'resolved'), resolved = comments.filter((comment) => comment.state === 'resolved')
  return <section id={`review-file-${review.id}-${file.id}`} data-file-id={file.id} className={`review-file-card [&.viewed_>_.review-file-heading]:[border-bottom-color:transparent] [&.viewed_.review-file-title]:text-soft relative z-0 isolate overflow-clip [border:1px_solid_transparent] rounded-(--radius-m) bg-card [scroll-margin-top:calc(var(--review-toolbar-height,_44px)_+_12px)] ${viewed ? ' viewed' : ''}`} aria-label={t("Changes to {0}", { "0": file.path })}><header className="review-file-heading [&_>_*]:flex-none [&_.review-file-path]:[flex:1_1_0] [&_.review-file-path]:min-w-[96px] [&_.review-file-path]:mr-1 [&_.review-file-title]:block [&_.review-file-title]:overflow-hidden [&_.review-file-title]:text-ellipsis [&_.review-file-title]:whitespace-nowrap [&_.review-file-title]:[overflow-wrap:normal] [&_.review-file-title]:text-control [&_.review-file-title]:font-medium [&_.small]:whitespace-nowrap [&_button.small-icon]:text-muted-foreground [&_button.small-icon]:rounded-(--radius-s) [&_.review-file-comment]:text-muted-foreground [&_.review-file-comment]:rounded-(--radius-s) [&_button.small-icon:hover:not(:disabled)]:text-foreground [&_.review-file-title.file-path]:flex [&_>_button.small:not(.icon)]:flex-initial [&_>_button.small:not(.icon)]:min-w-0 [&_>_button.small:not(.icon)]:overflow-hidden [&_>_button.small:not(.icon)]:text-ellipsis [&_>_button.small:not(.icon)]:whitespace-nowrap sticky top-[var(--review-toolbar-height,_44px)] z-10 flex items-center flex-nowrap gap-1 h-8 [box-sizing:border-box] p-[0_4px_0_2px] overflow-hidden bg-card [border-bottom:1px_solid_var(--line)] text-caption"><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</Button><div className="review-file-path flex flex-col min-w-0 gap-0.5 [overflow-wrap:anywhere]" title={`${file.repoName} · ${file.path}`}><FilePath className="review-file-title [&_.muted]:font-normal text-caption font-semibold [overflow-wrap:anywhere] leading-[18px]" path={file.path} /></div><LineStats files={[file]} />{comments.filter((c) => c.state !== 'resolved').length > 0 && <span className="review-discussion-count text-brand bg-brand-wash p-[0_5px] rounded-(--radius-xs) text-[length:11px]" title={t("Open discussions")} aria-label={t("{0} open discussions", { "0": comments.filter((c) => c.state !== 'resolved').length })}>{comments.filter((c) => c.state !== 'resolved').length}</span>}<span className="grow flex-1 min-w-0 text-left" />{!file.binary && <>
    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) review-nav" aria-label={t("Previous change")} title={t("Previous change")} onClick={() => window.dispatchEvent(new CustomEvent('ramu:review-nav', { detail: { fileId: file.id, direction: 'previous' } }))}><ChevronUp size={14} /></Button>
    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) review-nav" aria-label={t("Next change")} title={t("Next change")} onClick={() => window.dispatchEvent(new CustomEvent('ramu:review-nav', { detail: { fileId: file.id, direction: 'next' } }))}><ChevronDown size={14} /></Button>
  </>}
    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) review-file-comment gap-1.5 flex-none" aria-label={t("File comment")} title={t("File comment")} disabled={busy} onClick={() => startComment('new', 1, 1, 'file')}><MessageSquarePlus size={14} /></Button>
    <label className="review-viewed [&_[data-slot='checkbox']]:cursor-pointer inline-flex items-center gap-1.5 p-[4px_8px] [border-left:1px_solid_var(--line)] whitespace-nowrap text-soft cursor-pointer text-caption"><Checkbox checked={viewed} aria-labelledby={`review-viewed-${review.id}-${file.id}`} onCheckedChange={(checked) => { onViewed(checked); setCollapsed(checked && !showComposer) }} /><span id={`review-viewed-${review.id}-${file.id}`} className="sr-only">{t("Mark {0} as viewed", { "0": file.path })}</span><span aria-hidden="true">{t("Viewed")}</span></label>
    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Open {0} in editor", { "0": file.path })} title={t("Open file in editor")} disabled={file.status === 'deleted'} onClick={() => { if (file.status !== 'deleted') { ws.openTask(review.taskId); ws.openView(review.taskId, { kind: 'file', repoId: file.repoId, path: file.path }) } }}><ExternalLink size={14} /></Button></header>
    {!collapsed && <>{file.binary ? <p className="review-binary muted text-muted-foreground">{t("This binary or large file has no text diff.")}</p> : <ReviewDiff visible={visible} file={file} comments={comments} sideBySide={sideBySide} flow onSelect={() => { }} onComment={(side, line, endLine) => startComment(side, line, endLine)} inlineBlocks={inlineBlocks} />}
      {(fileComments.length > 0 || showComposer && location.scope === 'file' || resolved.length > 0) && <div className="review-file-discussion p-3 [border-top:1px_solid_var(--line)]">{showComposer && !editing && location.scope === 'file' && composer}{fileComments.map(renderThread)}{resolved.length > 0 && <Collapsible className="review-resolved"><CollapsibleTrigger render={<Button variant="ghost" />}>{t("Resolved discussions · ")}{resolved.length}</CollapsibleTrigger><CollapsibleContent>{resolved.map(renderThread)}</CollapsibleContent></Collapsible>}</div>}</>}
  </section>
}
/** One card for a comment in every state: the form for a new one, the posted note, and the same note while it is edited. */
const NOTE_CLASS = "review-note [&::before]:[content:''] [&::before]:absolute [&::before]:left-0 [&::before]:top-0 [&::before]:bottom-0 [&::before]:[background:var(--line-strong)] [&::before]:[opacity:0.85] [&::before]:w-0.5 [&.ai::before]:[background:var(--warn)] [&_>_header]:flex [&_>_header]:items-center [&_>_header]:gap-2 [&_>_header]:min-h-6 [&:hover_.review-note-actions]:opacity-100 [&_>_p]:m-[4px_0_0] [&_>_p]:text-control [&_>_p]:leading-[1.55] [&_>_p]:whitespace-pre-wrap [&_>_p]:[overflow-wrap:anywhere] [&.editing]:[border:1px_solid_var(--line-strong)] [&.editing]:p-[8px_12px_10px] [&.editing]:bg-raised [&.editing]:[transition:border-color_0.12s_var(--ease)] [&.editing_textarea]:block [&.editing_textarea]:w-full [&.editing_textarea]:text-control [&.editing_textarea]:leading-[1.5] [&.editing_textarea]:m-[4px_0_8px] [&.editing_textarea]:p-[2px_0] [&.editing_textarea]:bg-transparent [&.editing_textarea]:[border:0] [&.editing_textarea]:[border-radius:0] [&.editing_textarea]:[box-shadow:none] [&.editing_textarea]:resize-none [&.editing_textarea]:[field-sizing:content] [&.editing_textarea]:min-h-[44px] [&.editing_textarea]:max-h-[240px] [&.editing_textarea:focus-visible]:[outline:0] [&.editing_textarea:focus-visible]:[border:0] [&.editing_textarea:focus-visible]:[box-shadow:none] [.review-inline-body_&]:m-[6px_0] [.review-inline-body_&]:bg-raised [&.editing::before]:hidden [&.editing:focus-within]:[border-color:var(--line-strong)] relative m-[8px_0] p-[8px_12px_10px_14px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised overflow-hidden"
const WHERE_CLASS = "review-note-where [&:hover:not(:disabled)]:[background:color-mix(in_srgb,_var(--accent)_28%,_transparent)] [&:is(span)]:cursor-default p-[1px_7px] [border:0] rounded-(--radius-s) bg-brand-wash text-brand font-mono text-caption leading-[18px] cursor-pointer"
/** The comment form, new or editing. Its card, header and actions match the posted note and the chat's inline edit. */
function CommentForm({ inputRef, path, where, editing, value, unchanged, error, busy, onChange, onCancel, onSave }: { inputRef: React.RefObject<HTMLTextAreaElement | null>; path: string; where: string; editing: boolean; value: string; unchanged: boolean; error: string | null; busy: boolean; onChange: (value: string) => void; onCancel: () => void; onSave: () => void }) {
  useLanguage()
  const host = useHostConnection()
  const blocked = busy || host.offline || !value.trim() || unchanged
  const save = () => { if (!blocked) onSave() }
  const hint = host.offline ? t('Your draft is kept. Saving needs {0} online.', { 0: host.name }) : unchanged ? t('Nothing changed yet.') : t('Goes with your next message to the agent.')
  return <div className={`${NOTE_CLASS} editing`} role="region" aria-label={editing ? t("Editing comment") : t("New comment")}>
    <header><span className={WHERE_CLASS}>{where}</span><span className="muted text-muted-foreground small text-caption">{editing ? t("Editing comment") : t("New comment")}</span></header>
    <Textarea ref={inputRef} aria-label={t("Comment on {0}", { "0": path })} rows={2} maxLength={10000} placeholder={t("What should change, or what would you like to ask?")} value={value} onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save() } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() } }} />
    {error && <p className="error m-0 text-bad small text-caption" role="alert">{error}</p>}
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="mr-auto min-w-0 text-caption text-muted-foreground" role={host.offline ? 'status' : undefined}>{hint}</span>
      <Button variant="ghost" size="sm" className="text-caption" disabled={busy} title={t("Esc")} onClick={onCancel}>{t("Cancel")}</Button>
      <Button variant="default" size="sm" className="text-caption font-semibold" disabled={blocked} title={formatKeys('mod+enter')} onClick={save}>{editing ? t("Save") : t("Comment")}</Button>
    </div>
  </div>
}

function ReviewThread({ review, comment, onEdit, busy, onAct }: { review: ChangeReview; comment: ReviewComment; busy: boolean; onEdit: () => void; onAct: (fn: () => Promise<ChangeReview>) => Promise<ChangeReview | undefined> }) {
  useLanguage()
  const where = commentLabel(comment.side, comment.line, comment.endLine, comment.scope)
  const goTo = () => window.dispatchEvent(new CustomEvent('ramu:review-line', { detail: { fileId: comment.fileId, side: comment.side, line: comment.line, endLine: comment.endLine } }))
  return <article id={`review-thread-${comment.id}`} className={`${NOTE_CLASS} ${comment.author}`}>
    <header>
      <Button variant="secondary" type="button" className={`bg-fill hover:bg-fill-hover ${WHERE_CLASS}`} title={t("Show these lines")} onClick={goTo}>{where}</Button>
      <span className="muted text-muted-foreground small text-caption">{comment.author === 'ai' ? t("AI note") : t("Your comment")}</span>
      <span className="grow flex-1 min-w-0 text-left" />
      <span className="review-note-actions [&:focus-within]:opacity-100 inline-flex gap-0.5 opacity-0 [transition:opacity_0.12s_var(--ease)]">
        {comment.author === 'human' && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" disabled={busy} aria-label={t("Edit comment")} title={t("Edit comment")} onClick={onEdit}><Pencil size={13} /></Button>}
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" disabled={busy} aria-label={t("Delete comment")} title={t("Delete")} onClick={() => void onAct(() => invoke('reviews.removeComment', review.id, comment.id))}><Trash2 size={13} /></Button>
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
  const treeRoot = useRef<HTMLElement>(null)
  const [flat, setFlat] = useState(false)
  useLayoutEffect(() => {
    const element = treeRoot.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => { if (entry) setFlat(entry.contentRect.width < 220) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
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
    if (flat) return review.files.filter(file => !needle || file.path.toLowerCase().includes(needle)).sort((a, b) => a.path.localeCompare(b.path)).map(file => ({ key: `file:${file.id}`, depth: 0, file }))
    const visit = (node: Node, depth: number) => {
      for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const open = !!needle || !closed.has(dir.path)
        result.push({ key: `dir:${dir.path}`, depth, dir, open })
        if (open) visit(dir, depth + 1)
      }
      for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) result.push({ key: `file:${file.id}`, depth, file })
    }
    visit(tree, 0); return result
  }, [tree, closed, needle, flat, review.files])
  const render = (row: Row) => 'dir' in row
    ? <Button variant="tree" type="button" className="review-tree-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.active]:bg-accent [&.active]:text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground [&_.review-tree-viewed]:text-ok flex items-center gap-[5px] w-full min-h-[26px] p-[0_8px] [border:0] rounded-(--radius-s) bg-transparent text-soft text-caption text-left cursor-pointer dir" style={{ paddingLeft: 8 + row.depth * 12 }} aria-expanded={row.open} onClick={() => setClosed((current) => { const next = new Set(current); next.has(row.dir.path) ? next.delete(row.dir.path) : next.add(row.dir.path); return next })}>{row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="review-tree-name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{row.dir.name}</span></Button>
    : <Button variant="tree" type="button" className={`review-tree-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.active]:bg-accent [&.active]:text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground [&_.review-tree-viewed]:text-ok flex items-center gap-[5px] w-full min-h-[26px] p-[0_8px] [border:0] rounded-(--radius-s) bg-transparent text-soft text-caption text-left cursor-pointer file${activeId === row.file.id ? ' active' : ''}`} style={{ paddingLeft: flat ? 8 : 8 + row.depth * 12 + 17 }} title={row.file.path} onClick={() => onPick(row.file.id)}>
      <span className="review-tree-name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{row.file.path.slice(row.file.path.lastIndexOf('/') + 1)}</span>
      {viewedFiles.has(row.file.id) && <Check size={13} className="review-tree-viewed" aria-label={t("Viewed")} />}
      {counts.get(row.file.id) ? <span className="review-discussion-count text-brand bg-brand-wash p-[0_5px] rounded-(--radius-xs) text-[length:11px]">{counts.get(row.file.id)}</span> : null}
      {!row.file.binary && row.file.addedLines !== undefined && <span className="review-tree-stat inline-flex gap-1 flex-none text-[length:11px]"><span className="lines-added text-ok">+{row.file.addedLines}</span>{!!row.file.removedLines && <span className="lines-removed text-bad">−{row.file.removedLines}</span>}</span>}
    </Button>
  return <aside ref={treeRoot} data-flat={flat || undefined} className="review-tree [&_.review-tree-filter]:m-0 [&_.search-input]:w-full sticky top-[calc(var(--review-toolbar-height,_44px)_+_12px)] flex flex-col gap-1.5 max-h-[calc(100vh_-_200px)] min-w-0" aria-label={t("Changed files")}>
    <SearchInput className="review-tree-filter" aria-label={t("Filter files")} placeholder={t("Filter files…")} value={filter} onChange={(event) => setFilter(event.target.value)} onClear={() => setFilter('')} />
    <VirtualList items={rows} rowHeight={Math.max(27, preferences.fontSize + 12)} itemKey={(row) => row.key} renderItem={render} overlay className="review-tree-list min-h-0 flex-1 [overflow-anchor:none]" resetKey={`${needle}:${flat}`} revealKey={activeId ? `file:${activeId}` : undefined} />
  </aside>
}

/** A changed file's path: when space runs out the folder shortens first, so the file name stays readable. */
function FilePath({ path, className }: { path: string; className: string }) {
  const slash = path.lastIndexOf('/')
  return <span className={`file-path flex min-w-0 overflow-hidden whitespace-nowrap ${className}`}>{slash >= 0 && <span className="file-path-dir [flex:0_1000_auto] min-w-[2ch] overflow-hidden text-ellipsis text-muted-foreground font-normal">{path.slice(0, slash + 1)}</span>}<span className="file-path-name flex-initial text-foreground min-w-0 overflow-hidden text-ellipsis">{path.slice(slash + 1)}</span></span>
}

export function SessionChangesButton({ sessionId }: { sessionId: string }) {
  useLanguage()
  const ws = useWorkspace(), { reviews } = useReviews(), review = reviews.find((r) => r.sessionId === sessionId && r.files.length > 0)
  // Only chats that changed files get a review to open.
  if (!review || !review.files.length) return null
  return <Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" onClick={() => { openReview(ws, { id: review.id, taskId: review.taskId }) }}><FileDiff size={13} />{t("Changes · ")}{review.files.length}</Button>
}

export const TurnChanges = memo(function TurnChanges({ review }: { review: ChangeReview }) {
  useLanguage()
  const ws = useWorkspace()
  const [expanded, setExpanded] = useState(false)
  const commentCounts = useMemo(() => { const map = new Map<string, number>(); for (const comment of review.comments) if (comment.state !== 'resolved') map.set(comment.fileId, (map.get(comment.fileId) ?? 0) + 1); return map }, [review.comments])
  if (!review.files.length) return null
  const single = review.files.length === 1
  const visible = expanded ? review.files : review.files.slice(0, 3)
  const undone = review.files.every((file) => review.undoFileIds?.includes(file.id))
  const manyRepos = new Set(review.files.map((file) => file.repoId)).size > 1
  const renderFile = (file: ChangeFile) => {
    return <Button variant="ghost" className="chat-change-file" title={`${file.repoName}/${file.path}`} onClick={() => openReview(ws, { id: review.id, taskId: review.taskId, fileId: file.id })}>
      <FilePath className="chat-change-path flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" path={manyRepos ? `${file.repoName}/${file.path}` : file.path} />
      <LineStats files={[file]} />{file.binary && <span className="muted text-muted-foreground small text-caption">{t("Binary")}</span>}
      {!!commentCounts.get(file.id) && <span className="review-discussion-count text-brand bg-brand-wash p-[0_5px] rounded-(--radius-xs) text-[length:11px]" title={t("Open discussions")}>{commentCounts.get(file.id)}</span>}
    </Button>
  }
  return <section className="chat-changes [&_ul]:[list-style:none] [&_ul]:m-0 [&_ul]:p-0 [&_ul]:[border-top:1px_solid_var(--line)] [&_button.chat-change-file]:flex [&_button.chat-change-file]:items-center [&_button.chat-change-file]:justify-start [&_button.chat-change-file]:w-full [&_button.chat-change-file]:h-full [&_button.chat-change-file]:min-h-8 [&_button.chat-change-file]:p-[0_14px] [&_button.chat-change-file]:gap-3 [&_button.chat-change-file]:[border:0] [&_button.chat-change-file]:[border-radius:0] [&_button.chat-change-file]:bg-transparent [&_button.chat-change-file]:text-foreground [&_button.chat-change-file]:text-left [&_button.chat-change-file]:text-control [&_button.chat-change-file]:font-normal [&_button.chat-change-file:hover:not(:disabled)]:bg-hover m-[12px_0_16px] [border:1px_solid_transparent] rounded-(--radius-m) overflow-hidden bg-card text-control" aria-label={t("Files changed in this turn")}>
    <div className="chat-changes-heading flex items-center gap-3 p-[12px_12px_12px_14px]">
      <span className="chat-changes-icon [&_svg]:w-[18px] [&_svg]:h-[18px] flex items-center justify-center flex-none w-[36px] h-[36px] rounded-(--radius-s) bg-fill text-muted-foreground" aria-hidden="true"><FileDiff size={21} strokeWidth={1.6} /></span>
      <div className="chat-changes-summary [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-foreground [&_strong]:font-medium flex flex-col gap-0.5 flex-1 min-w-0"><strong title={single ? review.files[0]!.path : undefined}>{single ? t('Edited {0}', { '0': review.files[0]!.path.split('/').pop()! }) : t('Edited {0} files', { '0': review.files.length })}</strong><LineStats files={review.files} />{undone && <span className="muted text-muted-foreground small text-caption">{t('Changes undone')}</span>}</div>
      <div className="chat-changes-actions [&_>_.error]:max-w-[180px] flex items-center gap-1 flex-none"><UndoReview reviewId={review.id} disabled={undone || review.state !== 'ready'} /><Button size="sm" variant="secondary" className="small text-caption" onClick={() => openReview(ws, { id: review.id, taskId: review.taskId })}>{t("View changes")}</Button></div>
    </div>
    {!single && (expanded && review.files.length > 100
      ? <VirtualList items={review.files} rowHeight={32} itemKey={(file) => file.id} renderItem={renderFile} overlay className="chat-change-list max-h-[320px] [border-top:1px_solid_var(--line)]" />
      : <ul>{visible.map((file) => <li key={file.id}>{renderFile(file)}</li>)}</ul>)}
    {!single && review.files.length > 3 && <ExpandRow expanded={expanded} onToggle={() => setExpanded((value) => !value)}>{expanded ? t('Show fewer files') : t('Show {0} more files', { '0': review.files.length - 3 })}</ExpandRow>}
  </section>
})
