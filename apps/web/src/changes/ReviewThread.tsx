import { Pencil, Trash2 } from 'lucide-react'
import type { ChangeReview, ReviewComment } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { commentLabel } from '../git/ReviewChip'
import { ICON_BUTTON_CLASS, NOTE_CLASS, WHERE_CLASS } from './styles'
import { useHost } from '../workspace/HostProvider'

export function ReviewThread({
  review,
  comment,
  onEdit,
  busy,
  onAct,
}: {
  review: ChangeReview
  comment: ReviewComment
  busy: boolean
  onEdit: () => void
  onAct: (fn: () => Promise<ChangeReview>) => Promise<ChangeReview | undefined>
}) {
  useLanguage()
  const { invoke } = useHost()
  const where = commentLabel(comment.side, comment.line, comment.endLine, comment.scope)
  const goTo = () =>
    window.dispatchEvent(
      new CustomEvent('ramu:review-line', {
        detail: { fileId: comment.fileId, side: comment.side, line: comment.line, endLine: comment.endLine },
      }),
    )
  return (
    <article id={`review-thread-${comment.id}`} className={`${NOTE_CLASS} ${comment.author}`}>
      <header>
        <Button
          variant="secondary"
          type="button"
          className={`bg-fill hover:bg-fill-hover ${WHERE_CLASS}`}
          title={t('Show these lines')}
          onClick={goTo}
        >
          {where}
        </Button>
        <span className="muted text-muted-foreground small text-caption">
          {comment.author === 'ai' ? t('AI note') : t('Your comment')}
        </span>
        <span className="grow flex-1 min-w-0 text-left" />
        <span className="review-note-actions [&:focus-within]:opacity-100 inline-flex gap-0.5 opacity-0 [transition:opacity_0.12s_var(--ease)]">
          {comment.author === 'human' && (
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
              disabled={busy}
              aria-label={t('Edit comment')}
              title={t('Edit comment')}
              onClick={onEdit}
            >
              <Pencil size={13} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            disabled={busy}
            aria-label={t('Delete comment')}
            title={t('Delete')}
            onClick={() => void onAct(() => invoke('reviews.removeComment', review.id, comment.id))}
          >
            <Trash2 size={13} />
          </Button>
        </span>
      </header>
      <p>{comment.text}</p>
    </article>
  )
}
