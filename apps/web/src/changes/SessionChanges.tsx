import { FileDiff } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import type { ChangeFile, ChangeReview } from '@ramu/shared/types'
import { ExpandRow } from '@/components/expand-row'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { useWorkspace } from '../workspace'
import { UndoReview } from '../UndoRun'
import { LineStats } from '../LineStats'
import { useReviews, openReview } from '../reviews'
import { VirtualList } from '../VirtualList'
import { FilePath } from './FilePath'
import { DISCUSSION_COUNT_CLASS, TEXT_BUTTON_CLASS } from './styles'

export function SessionChangesButton({ sessionId }: { sessionId: string }) {
  useLanguage()
  const ws = useWorkspace(),
    { reviews } = useReviews(),
    review = reviews.find((r) => r.sessionId === sessionId && r.files.length > 0)
  // Only chats that changed files get a review to open.
  if (!review || !review.files.length) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className={TEXT_BUTTON_CLASS}
      onClick={() => {
        openReview(ws, { id: review.id, taskId: review.taskId })
      }}
    >
      <FileDiff size={13} />
      {t('Changes · ')}
      {review.files.length}
    </Button>
  )
}

export const TurnChanges = memo(function TurnChanges({ review }: { review: ChangeReview }) {
  useLanguage()
  const ws = useWorkspace()
  const [expanded, setExpanded] = useState(false)
  const commentCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const comment of review.comments)
      if (comment.state !== 'resolved') map.set(comment.fileId, (map.get(comment.fileId) ?? 0) + 1)
    return map
  }, [review.comments])
  if (!review.files.length) return null
  const single = review.files.length === 1
  const visible = expanded ? review.files : review.files.slice(0, 3)
  const undone = review.files.every((file) => review.undoFileIds?.includes(file.id))
  const manyRepos = new Set(review.files.map((file) => file.repoId)).size > 1
  const renderFile = (file: ChangeFile) => {
    return (
      <Button
        variant="ghost"
        className="chat-change-file"
        title={`${file.repoName}/${file.path}`}
        onClick={() => openReview(ws, { id: review.id, taskId: review.taskId, fileId: file.id })}
      >
        <FilePath
          className="chat-change-path flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
          path={manyRepos ? `${file.repoName}/${file.path}` : file.path}
        />
        <LineStats files={[file]} />
        {file.binary && <span className="muted text-muted-foreground small text-caption">{t('Binary')}</span>}
        {!!commentCounts.get(file.id) && (
          <span className={DISCUSSION_COUNT_CLASS} title={t('Open discussions')}>
            {commentCounts.get(file.id)}
          </span>
        )}
      </Button>
    )
  }
  return (
    <section
      className="chat-changes [&_ul]:[list-style:none] [&_ul]:m-0 [&_ul]:p-0 [&_ul]:[border-top:1px_solid_var(--line)] [&_button.chat-change-file]:flex [&_button.chat-change-file]:items-center [&_button.chat-change-file]:justify-start [&_button.chat-change-file]:w-full [&_button.chat-change-file]:h-full [&_button.chat-change-file]:min-h-8 [&_button.chat-change-file]:p-[0_14px] [&_button.chat-change-file]:gap-3 [&_button.chat-change-file]:[border:0] [&_button.chat-change-file]:[border-radius:0] [&_button.chat-change-file]:bg-transparent [&_button.chat-change-file]:text-foreground [&_button.chat-change-file]:text-left [&_button.chat-change-file]:text-control [&_button.chat-change-file]:font-normal [&_button.chat-change-file:hover:not(:disabled)]:bg-hover m-[12px_0_16px] [border:1px_solid_transparent] rounded-(--radius-m) overflow-hidden bg-card text-control"
      aria-label={t('Files changed in this turn')}
    >
      <div className="chat-changes-heading flex items-center gap-3 p-[12px_12px_12px_14px]">
        <span
          className="chat-changes-icon [&_svg]:w-[18px] [&_svg]:h-[18px] flex items-center justify-center flex-none w-[36px] h-[36px] rounded-(--radius-s) bg-fill text-muted-foreground"
          aria-hidden="true"
        >
          <FileDiff size={21} strokeWidth={1.6} />
        </span>
        <div className="chat-changes-summary [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-foreground [&_strong]:font-medium flex flex-col gap-0.5 flex-1 min-w-0">
          <strong title={single ? review.files[0]!.path : undefined}>
            {single
              ? t('Edited {0}', { '0': review.files[0]!.path.split('/').pop()! })
              : t('Edited {0} files', { '0': review.files.length })}
          </strong>
          <LineStats files={review.files} />
          {undone && <span className="muted text-muted-foreground small text-caption">{t('Changes undone')}</span>}
        </div>
        <div className="chat-changes-actions [&_>_.error]:max-w-[180px] flex items-center gap-1 flex-none">
          <UndoReview reviewId={review.id} disabled={undone || review.state !== 'ready'} />
          <Button
            size="sm"
            variant="secondary"
            className="small text-caption"
            onClick={() => openReview(ws, { id: review.id, taskId: review.taskId })}
          >
            {t('View changes')}
          </Button>
        </div>
      </div>
      {!single &&
        (expanded && review.files.length > 100 ? (
          <VirtualList
            items={review.files}
            rowHeight={32}
            itemKey={(file) => file.id}
            renderItem={renderFile}
            overlay
            className="chat-change-list max-h-[320px] [border-top:1px_solid_var(--line)]"
          />
        ) : (
          <ul>
            {visible.map((file) => (
              <li key={file.id}>{renderFile(file)}</li>
            ))}
          </ul>
        ))}
      {!single && review.files.length > 3 && (
        <ExpandRow expanded={expanded} onToggle={() => setExpanded((value) => !value)}>
          {expanded ? t('Show fewer files') : t('Show {0} more files', { '0': review.files.length - 3 })}
        </ExpandRow>
      )}
    </section>
  )
})
