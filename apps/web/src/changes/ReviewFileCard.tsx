import { ChevronDown, ChevronRight, ChevronUp, ExternalLink, MessageSquarePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeFile, ChangeReview, ReviewComment } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { t, useLanguage } from '../i18n'
import { useWorkspace } from '../workspace/workspace'
import { useReviewDraft } from '../git/reviewDrafts'
import { ReviewDiff, type InlineReviewBlock } from '../git/ReviewDiff'
import { LineStats } from '../git/LineStats'
import { commentLabel } from '../git/ReviewChip'
import { CommentForm } from './CommentForm'
import { FilePath } from './FilePath'
import { ReviewThread } from './ReviewThread'
import { DISCUSSION_COUNT_CLASS, ICON_BUTTON_CLASS } from './styles'
import { useHost } from '../workspace/HostProvider'
import { reviewRichKind } from '@ramu/shared/review/reviewRich'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ReviewBinaryNote } from './ReviewImageDiff'
import { ReviewRichDiff } from './ReviewRichDiff'

export function ReviewFileCard({
  file,
  review,
  comments,
  visible,
  sideBySide,
  busy,
  onAct,
  viewed,
  onViewed,
}: {
  viewed: boolean
  onViewed: (viewed: boolean) => void
  file: ChangeFile
  review: ChangeReview
  sideBySide: boolean
  busy: boolean
  onAct: (fn: () => Promise<ChangeReview>) => Promise<ChangeReview | undefined>
  comments: ReviewComment[]
  visible: boolean
}) {
  useLanguage()
  const ws = useWorkspace()
  const { invoke } = useHost()
  const [collapsed, setCollapsed] = useState(viewed),
    [composerOpen, setComposerOpen] = useState(false),
    [draftError, setDraftError] = useState<string | null>(null)
  const [location, setLocation] = useReviewDraft<{
    side: 'old' | 'new'
    line: number
    endLine: number
    scope: 'file' | 'line'
  }>(`${review.id}:${file.id}:location`, { side: 'new', line: 1, endLine: 1, scope: 'file' })
  const [draft, setDraft] = useReviewDraft(`${review.id}:${file.id}:text`, ''),
    [editing, setEditing] = useReviewDraft<string | null>(`${review.id}:${file.id}:editing`, null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  // Pictures, prose, tables, notebooks and models open drawn, as GitHub's rich diffs do; when the file is also text
  // (an SVG, Markdown, CSV, a notebook) its source diff is one switch away.
  const rich = reviewRichKind(file.path)
  const [source, setSource] = useState(false)
  useEffect(() => {
    const reveal = (event: Event) => {
      if ((event as CustomEvent).detail?.fileId === file.id) setCollapsed(false)
    }
    window.addEventListener('ramu:review-file', reveal)
    window.addEventListener('ramu:review-line', reveal)
    return () => {
      window.removeEventListener('ramu:review-file', reveal)
      window.removeEventListener('ramu:review-line', reveal)
    }
  }, [file.id])
  // Comments leave the diff once they are sent with a chat message.
  const startComment = (side: 'old' | 'new', line: number, endLine: number, scope: 'file' | 'line' = 'line') => {
    if (
      draft.trim() &&
      (location.side !== side || location.line !== line || location.endLine !== endLine || location.scope !== scope)
    ) {
      setDraftError(t('Add or cancel your current draft before starting another comment.'))
      draftRef.current?.focus()
      return
    }
    setLocation({ side, line, endLine, scope })
    setComposerOpen(true)
    setCollapsed(false)
    setDraftError(null)
    requestAnimationFrame(() => {
      draftRef.current?.scrollIntoView({ block: 'nearest' })
      draftRef.current?.focus()
    })
  }
  const editComment = (comment: ReviewComment) => {
    if (draft.trim() && editing !== comment.id) {
      setDraftError(t('Add or cancel your current draft first.'))
      return
    }
    setEditing(comment.id)
    setLocation({ side: comment.side, line: comment.line, endLine: comment.endLine, scope: comment.scope ?? 'line' })
    setDraft(comment.text)
    setComposerOpen(true)
    setCollapsed(false)
    setDraftError(null)
    requestAnimationFrame(() => {
      draftRef.current?.scrollIntoView({ block: 'nearest' })
      draftRef.current?.focus()
    })
  }
  const save = async () => {
    const result = await onAct(() =>
      invoke('reviews.comment', review.id, { fileId: file.id, ...location, text: draft }, editing ?? undefined),
    )
    if (result) {
      setDraft('')
      setEditing(null)
      setComposerOpen(false)
      setDraftError(null)
    }
  }
  // An edited comment turns into the form where it stands, as a chat message does.
  const renderThread = (comment: ReviewComment) =>
    comment.id === editing ? (
      composer
    ) : (
      <ReviewThread
        key={comment.id}
        review={review}
        comment={comment}
        busy={busy}
        onEdit={() => editComment(comment)}
        onAct={onAct}
      />
    )
  const original = editing ? comments.find((comment) => comment.id === editing)?.text : undefined
  const cancel = () => {
    setComposerOpen(false)
    setEditing(null)
    setDraft('')
    setDraftError(null)
  }
  const composer = (
    <CommentForm
      key="comment-form"
      inputRef={draftRef}
      path={file.path}
      where={commentLabel(location.side, location.line, location.endLine, location.scope)}
      editing={!!editing}
      value={draft}
      unchanged={original !== undefined && draft.trim() === original.trim()}
      error={draftError}
      busy={busy}
      onChange={setDraft}
      onCancel={cancel}
      onSave={() => void save()}
    />
  )
  const showComposer = composerOpen || !!draft.trim() || !!editing
  const groups = new Map<string, ReviewComment[]>()
  for (const comment of comments.filter((comment) => comment.scope !== 'file' && comment.state !== 'resolved')) {
    const key = `${comment.side}:${comment.endLine}`
    groups.set(key, [...(groups.get(key) ?? []), comment])
  }
  const inlineBlocks: InlineReviewBlock[] = [...groups].map(([key, threads]) => ({
    key,
    side: threads[0]!.side,
    line: threads[0]!.endLine,
    content: <div className="review-inline-threads">{threads.map(renderThread)}</div>,
  }))
  if (showComposer && !editing && location.scope !== 'file')
    inlineBlocks.push({ key: 'draft', side: location.side, line: location.endLine, content: composer })
  const fileComments = comments.filter((comment) => comment.scope === 'file' && comment.state !== 'resolved'),
    resolved = comments.filter((comment) => comment.state === 'resolved')
  return (
    <section
      id={`review-file-${review.id}-${file.id}`}
      data-file-id={file.id}
      className={`review-file-card [&.viewed_>_.review-file-heading]:[border-bottom-color:transparent] [&.viewed_.review-file-title]:text-soft relative z-0 isolate overflow-clip [border:1px_solid_transparent] rounded-(--radius-m) bg-card [scroll-margin-top:calc(var(--review-toolbar-height,_44px)_+_var(--review-banner-height,_0px)_+_12px)] ${viewed ? ' viewed' : ''}`}
      aria-label={t('Changes to {0}', { '0': file.path })}
    >
      <header className="review-file-heading [&_>_*]:flex-none [&_.review-file-path]:[flex:1_1_0] [&_.review-file-path]:min-w-[96px] [&_.review-file-path]:mr-1 [&_.review-file-title]:block [&_.review-file-title]:overflow-hidden [&_.review-file-title]:text-ellipsis [&_.review-file-title]:whitespace-nowrap [&_.review-file-title]:[overflow-wrap:normal] [&_.review-file-title]:text-control [&_.review-file-title]:font-medium [&_.small]:whitespace-nowrap [&_button.small-icon]:text-muted-foreground [&_button.small-icon]:rounded-(--radius-s) [&_.review-file-comment]:text-muted-foreground [&_.review-file-comment]:rounded-(--radius-s) [&_button.small-icon:hover:not(:disabled)]:text-foreground [&_.review-file-title.file-path]:flex [&_>_button.small:not(.icon)]:flex-initial [&_>_button.small:not(.icon)]:min-w-0 [&_>_button.small:not(.icon)]:overflow-hidden [&_>_button.small:not(.icon)]:text-ellipsis [&_>_button.small:not(.icon)]:whitespace-nowrap sticky top-[calc(var(--review-toolbar-height,_44px)_+_var(--review-banner-height,_0px))] z-10 flex items-center flex-nowrap gap-1 h-8 [box-sizing:border-box] p-[0_4px_0_2px] overflow-hidden bg-card [border-bottom:1px_solid_var(--line)] text-caption">
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON_CLASS}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </Button>
        <div
          className="review-file-path flex flex-col min-w-0 gap-0.5 [overflow-wrap:anywhere]"
          title={`${file.repoName} · ${file.path}`}
        >
          <FilePath
            className="review-file-title [&_.muted]:font-normal text-caption font-semibold [overflow-wrap:anywhere] leading-[18px]"
            path={file.path}
          />
        </div>
        <LineStats files={[file]} />
        {file.sharedWith?.length ? (
          <span
            className="whitespace-nowrap text-caption text-muted-foreground"
            title={t('Not undone with this turn, so the other thread keeps its edits.')}
          >
            {t('Also changed by “{0}”', {
              0: file.sharedWith.map((id) => ws.task(id)?.title ?? t('Another thread')).join(', '),
            })}
          </span>
        ) : file.editedByYou ? (
          <span
            className="whitespace-nowrap text-caption text-muted-foreground"
            title={t('Not undone with this turn, so your edits stay.')}
          >
            {t('Also edited by you')}
          </span>
        ) : null}
        {comments.filter((c) => c.state !== 'resolved').length > 0 && (
          <span
            className={DISCUSSION_COUNT_CLASS}
            title={t('Open discussions')}
            aria-label={t('{0} open discussions', { '0': comments.filter((c) => c.state !== 'resolved').length })}
          >
            {comments.filter((c) => c.state !== 'resolved').length}
          </span>
        )}
        <span className="grow flex-1 min-w-0 text-left" />
        {!file.binary && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              className={`${ICON_BUTTON_CLASS} review-nav`}
              aria-label={t('Previous change')}
              title={t('Previous change')}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('ramu:review-nav', { detail: { fileId: file.id, direction: 'previous' } }),
                )
              }
            >
              <ChevronUp size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className={`${ICON_BUTTON_CLASS} review-nav`}
              aria-label={t('Next change')}
              title={t('Next change')}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('ramu:review-nav', { detail: { fileId: file.id, direction: 'next' } }),
                )
              }
            >
              <ChevronDown size={14} />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={`${ICON_BUTTON_CLASS} review-file-comment gap-1.5 flex-none`}
          aria-label={t('File comment')}
          title={t('File comment')}
          disabled={busy}
          onClick={() => startComment('new', 1, 1, 'file')}
        >
          <MessageSquarePlus size={14} />
        </Button>
        <label className="review-viewed [&_[data-slot='checkbox']]:cursor-pointer inline-flex items-center gap-1.5 p-[4px_8px] [border-left:1px_solid_var(--line)] whitespace-nowrap text-soft cursor-pointer text-caption">
          <Checkbox
            checked={viewed}
            aria-labelledby={`review-viewed-${review.id}-${file.id}`}
            onCheckedChange={(checked) => {
              onViewed(checked)
              setCollapsed(checked && !showComposer)
            }}
          />
          <span id={`review-viewed-${review.id}-${file.id}`} className="sr-only">
            {t('Mark {0} as viewed', { '0': file.path })}
          </span>
          <span aria-hidden="true">{t('Viewed')}</span>
        </label>
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON_CLASS}
          aria-label={t('Open {0} in editor', { '0': file.path })}
          title={t('Open file in editor')}
          disabled={file.status === 'deleted'}
          onClick={() => {
            if (file.status !== 'deleted') {
              ws.openTask(review.taskId)
              ws.openView(review.taskId, { kind: 'file', repoId: file.repoId, path: file.path })
            }
          }}
        >
          <ExternalLink size={14} />
        </Button>
      </header>
      {!collapsed && (
        <>
          {rich && !file.binary && (
            <ToggleGroup
              size="sm"
              spacing={0.5}
              value={[source ? 'source' : 'rendered']}
              onValueChange={(next) => next[0] && setSource(next[0] === 'source')}
              aria-label={t('Show the file drawn or as source')}
              className="px-3 pt-3"
            >
              <ToggleGroupItem value="rendered">{t('Rendered')}</ToggleGroupItem>
              <ToggleGroupItem value="source">{t('Source')}</ToggleGroupItem>
            </ToggleGroup>
          )}
          {rich && (file.binary || !source) ? (
            <ReviewRichDiff kind={rich} reviewId={review.id} file={file} />
          ) : file.binary ? (
            <ReviewBinaryNote file={file} />
          ) : (
            <ReviewDiff
              visible={visible}
              file={file}
              comments={comments}
              sideBySide={sideBySide}
              flow
              onSelect={() => {}}
              onComment={(side, line, endLine) => startComment(side, line, endLine)}
              inlineBlocks={inlineBlocks}
            />
          )}
          {(fileComments.length > 0 || (showComposer && location.scope === 'file') || resolved.length > 0) && (
            <div className="review-file-discussion p-3 [border-top:1px_solid_var(--line)]">
              {showComposer && !editing && location.scope === 'file' && composer}
              {fileComments.map(renderThread)}
              {resolved.length > 0 && (
                <Collapsible className="review-resolved">
                  <CollapsibleTrigger render={<Button variant="ghost" />}>
                    {t('Resolved discussions · ')}
                    {resolved.length}
                  </CollapsibleTrigger>
                  <CollapsibleContent>{resolved.map(renderThread)}</CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
