import { MessageSquare, PanelLeft } from 'lucide-react'
import { DiffLayoutToggle } from '../git/diffLayout'
import type { ChangeReview } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { formatChatDate } from '@ramu/shared/chat/chatDates'
import { t, formatLocale, currentLanguage } from '../i18n'
import { Dropdown } from '../Menu'
import { LineStats } from '../git/LineStats'
import { ICON_BUTTON_CLASS } from './styles'

export function ReviewToolbar({
  review,
  revisions,
  viewedCount,
  busy,
  showTree,
  split,
  narrow,
  onToggleTree,
  onOpenRevision,
  onChangeLayout,
  onOpenChat,
}: {
  review: ChangeReview
  revisions: ChangeReview[]
  viewedCount: number
  busy: boolean
  showTree: boolean
  split: boolean
  narrow: boolean
  onToggleTree: () => void
  onOpenRevision: (id: string) => void
  onChangeLayout: (split: boolean) => void
  onOpenChat: () => void
}) {
  return (
    <div className="review-toolbar [&_>_*]:flex-none [&_>_.grow]:flex-1 [&_>_.grow]:min-w-1 [&_button.small-icon]:text-muted-foreground [&_button.small-icon]:rounded-(--radius-s) [&_button.small-icon:hover:not(:disabled)]:text-foreground [&_button.small-icon[aria-pressed='true']]:text-foreground [&_.review-layout-toggle_button.small-icon]:w-6 [&_.review-layout-toggle_button.small-icon]:h-6 [&_.review-layout-toggle_button.small-icon]:rounded-(--radius-xs) [&_.review-layout-toggle_button.small-icon[aria-pressed='true']]:bg-raised [&_.review-layout-toggle_button.small-icon[aria-pressed='true']]:text-foreground [&_.review-layout-toggle_button.small-icon[aria-pressed='true']]:[box-shadow:0_1px_2px_rgba(0,_0,_0,_0.2)] flex items-center gap-1 min-h-[40px] p-[0_8px] whitespace-nowrap overflow-hidden">
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON_CLASS}
        aria-pressed={showTree}
        aria-label={showTree ? t('Hide file tree') : t('Show file tree')}
        title={showTree ? t('Hide file tree') : t('Show file tree')}
        onClick={onToggleTree}
      >
        <PanelLeft size={14} />
      </Button>
      <span className="review-bar-summary [&_strong]:font-medium inline-flex items-center gap-2 ml-1 text-control">
        <strong>{review.files.length === 1 ? t('1 file') : t('{0} files', { '0': review.files.length })}</strong>
        <LineStats files={review.files} />
      </span>
      {revisions.length > 1 ? (
        <Dropdown
          label={t('Review revision')}
          className="shrink! min-w-0! max-w-[min(100%,260px)] overflow-hidden"
          disabled={busy}
          value={review.id}
          onChange={(value) => onOpenRevision(value)}
          options={revisions.map((r, i) => ({
            value: r.id,
            label: t('{0}Revision {1} · {2}', {
              '0': i === 0 ? 'Latest · ' : '',
              '1': revisions.length - i,
              '2': formatChatDate(r.createdAt, Date.now(), currentLanguage()),
            }),
          }))}
        />
      ) : (
        <time
          className="review-bar-date text-muted-foreground text-caption tabular-nums ml-1.5"
          dateTime={new Date(review.createdAt).toISOString()}
          title={new Date(review.createdAt).toLocaleString(formatLocale())}
        >
          {formatChatDate(review.createdAt, Date.now(), currentLanguage())}
        </time>
      )}
      <span className="grow flex-1 min-w-0 text-left" />
      <span
        className="review-viewed-progress whitespace-nowrap text-muted-foreground text-caption tabular-nums mr-1.5"
        role="status"
      >
        {t('{0} / {1} viewed', {
          '0': viewedCount,
          '1': review.files.length,
        })}
      </span>
      <DiffLayoutToggle
        split={split}
        narrow={narrow}
        label={t('Layout for all file diffs')}
        onChange={onChangeLayout}
      />
      {review.sessionId && (
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON_CLASS}
          aria-label={t('Open thread')}
          title={t('Open thread')}
          onClick={onOpenChat}
        >
          <MessageSquare size={14} />
        </Button>
      )}
    </div>
  )
}
