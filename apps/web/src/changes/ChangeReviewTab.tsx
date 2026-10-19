import { ArrowRight, FileDiff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeReview, ReviewComment, ViewDescriptor } from '@ramu/shared/types'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { ContentSkeleton } from '@/components/content-skeleton'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Button } from '@/components/desktop-button'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { enterReviewFile } from '../git/ReviewDiff'
import { useReviews, openReview } from '../git/reviews'
import { DeferredReviewFile } from './DeferredReviewFile'
import { LargeDiffBanner } from './LargeDiffBanner'
import { ReviewBranchContext } from './ReviewBranchContext'
import { ReviewFileCard } from './ReviewFileCard'
import { ReviewFileTree } from './ReviewFileTree'
import { ReviewToolbar } from './ReviewToolbar'
import { useReviewBranches } from './useReviewBranches'
import { useReviewLayout } from './useReviewLayout'
import { useViewedFiles } from './useViewedFiles'
import { TEXT_BUTTON_CLASS } from './styles'
import { useHost } from '../workspace/HostProvider'

export function ChangeReviewTab({
  view,
  visible = true,
}: {
  view: Extract<ViewDescriptor, { kind: 'review' }>
  visible?: boolean
}) {
  useLanguage()
  const ws = useWorkspace(),
    { reviews } = useReviews()
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const id = view.reviewId
  const { viewedFiles, markViewed } = useViewedFiles(id)
  const [review, setReview] = useState<ChangeReview | null>(null)
  const [activeFileId, setActiveFileId] = useState<string | null>(null),
    [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const { narrow, split, showTree, toggleTree, changeLayout, closeNarrowTree } = useReviewLayout(root, review?.id)
  const currentId = useRef(id)
  currentId.current = id
  useEffect(() => {
    setReview(null)
    setError(null)
  }, [id])
  const threadTarget = view.threadId
  useEffect(() => {
    const activate = (event: Event) => {
      const fileId = (event as CustomEvent).detail?.fileId
      if (fileId) setActiveFileId(fileId)
    }
    window.addEventListener('ramu:review-file', activate)
    window.addEventListener('ramu:review-line', activate)
    return () => {
      window.removeEventListener('ramu:review-file', activate)
      window.removeEventListener('ramu:review-line', activate)
    }
  }, [])
  useEffect(() => {
    if (view.fileId) setActiveFileId(view.fileId)
  }, [view.fileId, view.requestId])
  useEffect(() => {
    const fileId = review?.comments.find((c) => c.id === threadTarget)?.fileId
    if (fileId) setActiveFileId(fileId)
  }, [threadTarget, review?.id])
  useEffect(() => {
    setActiveFileId(null)
    setShowAll(false)
  }, [id])
  const reload = useCallback(async () => {
    if (!id) return
    const r = await invoke('reviews.get', id)
    if (currentId.current !== id) return
    setReview(r)
  }, [invoke, id])
  useEffect(() => {
    if (!visible) return
    void reload().catch((e) => setError(errorText(e)))
    return on('automation:changed', () => {
      void reload().catch(() => {})
    })
  }, [on, reload, visible])
  const { branches, branchError } = useReviewBranches(id, review?.id, visible)
  useEffect(() => {
    if (!threadTarget || review?.id !== id) return
    const frame = requestAnimationFrame(() => {
      const thread = document.getElementById(`review-thread-${threadTarget}`)
      const details = thread?.closest('details')
      if (details) details.open = true
      thread?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [threadTarget, review?.id])
  useEffect(() => {
    if (review?.id === view.reviewId && view.fileId && !view.threadId) {
      const frame = requestAnimationFrame(() => {
        const card = root.current?.querySelector<HTMLElement>(`[data-file-id="${view.fileId}"]`)
        window.dispatchEvent(new CustomEvent('ramu:review-file', { detail: { fileId: view.fileId } }))
        card?.scrollIntoView({ block: 'start' })
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [review?.id, view.requestId])
  const act = async (fn: () => Promise<ChangeReview>) => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if (currentId.current !== r.id) return
      setReview(r)
      return r
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const revisions = reviews.filter((r) => r.taskId === review?.taskId)
  const files = review?.files ?? []
  const changedLines = useMemo(
    () => files.reduce((sum, file) => sum + (file.addedLines ?? 0) + (file.removedLines ?? 0), 0),
    [files],
  )
  const commentsByFile = useMemo(() => {
    const map = new Map<string, ReviewComment[]>()
    for (const comment of review?.comments ?? [])
      if (comment.state === 'draft') {
        const group = map.get(comment.fileId) ?? []
        group.push(comment)
        map.set(comment.fileId, group)
      }
    return map
  }, [review?.comments])
  const large = files.length > 25 || changedLines > 2500
  const oneAtATime = large && !showAll
  const activeIndex = Math.max(
    0,
    files.findIndex((file) => file.id === activeFileId),
  )
  const visibleFiles = oneAtATime && files.length ? [files[activeIndex]!] : files
  // Stepping past a file's last (or first) change continues in the next file with a text diff, wrapping at the ends.
  const filesRef = useRef(files)
  filesRef.current = files
  useEffect(() => {
    const move = (event: Event) => {
      const { fileId, direction } = (event as CustomEvent).detail ?? {},
        all = filesRef.current,
        from = all.findIndex((file) => file.id === fileId)
      if (from < 0) return
      const step = direction === 'next' ? 1 : -1
      for (let i = 1; i <= all.length; i++) {
        const target = all[(from + ((step * i) % all.length) + all.length) % all.length]!
        if (target.binary) continue
        window.dispatchEvent(new CustomEvent('ramu:review-file', { detail: { fileId: target.id } }))
        enterReviewFile(target.id, direction)
        return
      }
    }
    window.addEventListener('ramu:review-nav-file', move)
    return () => window.removeEventListener('ramu:review-nav-file', move)
  }, [])
  const pickFile = (fileId: string) => {
    window.dispatchEvent(new CustomEvent('ramu:review-file', { detail: { fileId } }))
    if (oneAtATime) {
      setActiveFileId(fileId)
      root.current?.scrollTo?.({ top: 0 })
    } else
      root.current
        ?.querySelector<HTMLElement>(`[data-file-id="${fileId}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const openChat = () => {
    if (review?.sessionId) {
      ws.openTask(review.taskId)
      ws.openView(review.taskId, { kind: 'agent', sessionId: review.sessionId })
    }
  }
  return (
    <OverlayScrollArea
      className="h-full flex-1 min-w-0 w-full isolate [container-type:inline-size]"
      viewportClassName="changes-page pair-review changes-tab h-full"
      viewportRef={root}
      contentClassName="flex flex-col gap-2 p-[0_8px_12px] min-h-full [--review-page-padding-top:0px]"
    >
      {!review && id && !error && <ContentSkeleton variant="cards" rows={3} label={t('Loading changes…')} />}
      {!review && (!id || error) && (
        <Empty className="automation-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileDiff />
            </EmptyMedia>
            <EmptyTitle>{id && !error ? t('Loading changes…') : t('No changes to review')}</EmptyTitle>
            <EmptyDescription>{t('Changed files will appear here after the agent finishes.')}</EmptyDescription>
          </EmptyHeader>
          {error && (
            <EmptyContent>
              <p className="error text-bad" role="alert">
                {error}
              </p>
            </EmptyContent>
          )}
        </Empty>
      )}
      {review && (
        <>
          <div className="pair-review-bar sticky top-0 z-20 m-[0_-8px] bg-canvas [border-bottom:var(--pane-border-width)_solid_var(--pane-border-color)]">
            <ReviewBranchContext branches={branches} error={branchError} />
            <ReviewToolbar
              review={review}
              revisions={revisions}
              viewedCount={files.filter((file) => viewedFiles.has(file.id)).length}
              busy={busy}
              showTree={showTree}
              split={split}
              narrow={narrow}
              onToggleTree={toggleTree}
              onOpenRevision={(value) => openReview(ws, { id: value }, invoke)}
              onChangeLayout={changeLayout}
              onOpenChat={openChat}
            />
          </div>
          {revisions[0] && revisions[0].id !== review.id && (
            <div className="review-newer flex items-center justify-between gap-3 bg-brand-wash rounded-(--radius-s) p-[6px_12px] text-caption">
              <span>{t("You're viewing an earlier revision.")}</span>
              <Button
                variant="ghost"
                size="sm"
                className={TEXT_BUTTON_CLASS}
                onClick={() => openReview(ws, { id: revisions[0]!.id }, invoke)}
              >
                {t('View latest changes ')}
                <ArrowRight size={13} />
              </Button>
            </div>
          )}
          {(error || review.error) && (
            <p className="error text-bad small text-caption" role="alert">
              {error ?? review.error}
            </p>
          )}
          {review.undoneAt && (
            <p className="muted text-muted-foreground small text-caption">
              {review.undoFileIds?.length ?? 0} {t(' files undone. This diff shows the original changes.')}
            </p>
          )}
          <div
            className={`review-split [&.no-tree]:[grid-template-columns:minmax(0,_1fr)] grid [grid-template-columns:clamp(160px,_20cqw,_240px)_minmax(0,_1fr)] gap-2 [align-items:start] ${showTree ? '' : ' no-tree'}`}
          >
            {showTree && (
              <ReviewFileTree
                review={review}
                viewedFiles={viewedFiles}
                activeId={oneAtATime ? files[activeIndex]?.id : undefined}
                onPick={(fileId) => {
                  pickFile(fileId)
                  if (narrow) closeNarrowTree()
                }}
              />
            )}
            <div className="review-main min-w-0 flex flex-col gap-2">
              {large && (
                <LargeDiffBanner
                  oneAtATime={oneAtATime}
                  activeIndex={activeIndex}
                  count={files.length}
                  onStep={(delta) => setActiveFileId(files[activeIndex + delta]!.id)}
                  onToggleAll={() => setShowAll(!showAll)}
                />
              )}
              <div className="review-file-stack flex flex-col gap-2">
                {visibleFiles.map((file) => (
                  <DeferredReviewFile key={`${review.id}:${file.id}`} file={file} visible={visible}>
                    <ReviewFileCard
                      file={file}
                      review={review}
                      viewed={viewedFiles.has(file.id)}
                      onViewed={(viewed) => markViewed(file.id, viewed)}
                      comments={commentsByFile.get(file.id) ?? []}
                      visible={visible}
                      sideBySide={split}
                      busy={busy}
                      onAct={act}
                    />
                  </DeferredReviewFile>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </OverlayScrollArea>
  )
}
