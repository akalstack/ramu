import { t, useLanguage } from '../i18n'
import { Button } from '@/components/desktop-button'
import { MessageSquareText, X } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import type { ChangeReview } from '@ramu/shared/types'

export interface PendingComments {
  review: ChangeReview
  ids: string[]
}

/** Unsent review comments for a chat, newest revision first. */
export function pendingComments(reviews: ChangeReview[], sessionId: string): PendingComments[] {
  return reviews
    .filter((review) => review.sessionId === sessionId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((review) => ({
      review,
      ids: review.comments.filter((c) => c.state === 'draft' && c.readyToSend !== false).map((c) => c.id),
    }))
    .filter((group) => group.ids.length > 0)
}

/** Where a comment sits, as people read it: "Line 301", "Lines 12–18", or "Old line 7" for a removed line. */
export const commentLabel = (side: 'old' | 'new', line: number, endLine: number, scope?: string) => {
  if (scope === 'file') return t('File')
  const lines = endLine !== line ? `${line}–${endLine}` : String(line)
  if (side === 'old') return endLine !== line ? t('Old lines {0}', { 0: lines }) : t('Old line {0}', { 0: lines })
  return endLine !== line ? t('Lines {0}', { 0: lines }) : t('Line {0}', { 0: lines })
}

/** "2 comments" above the message box; hover for the list, × to take them off this message (they stay on the diff). */
export function CommentsChip({ groups, onRemove }: { groups: PendingComments[]; onRemove: () => void }) {
  useLanguage()
  const items = groups.flatMap((group) =>
    group.ids.map((id) => {
      const comment = group.review.comments.find((c) => c.id === id)!
      const file = group.review.files.find((f) => f.id === comment.fileId)
      return {
        id,
        path: file?.path ?? 'file',
        label: commentLabel(comment.side, comment.line, comment.endLine, comment.scope),
        text: comment.text,
      }
    }),
  )
  if (!items.length) return null
  return (
    <HoverCard>
      <div className="comments-chip-wrap relative self-start m-[4px_0_8px]">
        <HoverCardTrigger
          delay={150}
          closeDelay={120}
          render={
            <span
              className="attachment-chip [&_img]:w-[36px] [&_img]:h-[36px] [&_img]:object-cover [&_img]:rounded-(--radius-xs) [&_button]:flex-none [&_svg]:flex-none [&_.attachment-open.file]:inline-flex [&_.attachment-open.file]:items-center [&_.attachment-open.file]:gap-[7px] [&_.attachment-open.file]:p-[5px_9px] [&_.attachment-open.file]:max-w-[240px] [&_.attachment-open.file]:bg-transparent [&_.attachment-open.file]:[border:0] [&_.attachment-open.file]:text-left [&_.attachment-open.file]:justify-start [&_.attachment-open.file]:cursor-pointer [&_.attachment-remove]:top-[-7px] [&_.attachment-remove]:right-[-7px] [&:not(.comments-chip)_.attachment-remove]:opacity-0 [&:not(.comments-chip)_.attachment-remove]:[transition:none] [&:hover_.attachment-remove]:opacity-100 [&:hover_.attachment-remove]:[transition:opacity_0.12s_var(--ease)] [&_button.comments-chip-x]:absolute [&_button.comments-chip-x]:top-[50%] [&_button.comments-chip-x]:right-1 [&_button.comments-chip-x]:bottom-auto [&_button.comments-chip-x]:left-auto [&_button.comments-chip-x]:w-5 [&_button.comments-chip-x]:h-5 [&_button.comments-chip-x]:min-w-0 [&_button.comments-chip-x]:min-h-0 [&_button.comments-chip-x]:m-0 [&_button.comments-chip-x]:p-0 [&_button.comments-chip-x]:grid [&_button.comments-chip-x]:place-items-center [&_button.comments-chip-x]:[border:0] [&_button.comments-chip-x]:rounded-full [&_button.comments-chip-x]:[transform:translateY(-50%)] [&_button.comments-chip-x]:opacity-0 [&_button.comments-chip-x]:[transition:none] [&:hover_button.comments-chip-x]:opacity-100 [&:hover_button.comments-chip-x]:[transition:opacity_0.12s_var(--ease)] [&_button.comments-chip-x:focus-visible]:opacity-100 [&_button.comments-chip-x:focus-visible]:[transition:opacity_0.12s_var(--ease)] inline-flex items-center gap-[7px] max-w-[240px] min-w-0 [border:1px_solid_transparent] rounded-(--radius-s) text-control whitespace-normal relative p-0 bg-hover comments-chip [&:focus-visible]:[border-color:var(--line-strong)] [&_.attachment-open.file]:pr-3 [&_.attachment-open.file]:[transition:none] [&:hover_.attachment-open.file]:pr-[30px] [&:hover_.attachment-open.file]:[mask-image:linear-gradient(to_right,_#000_calc(100%_-_52px),_transparent_calc(100%_-_14px))] [&:focus-within_.attachment-open.file]:pr-[30px] [&:focus-within_.attachment-open.file]:[mask-image:linear-gradient(to_right,_#000_calc(100%_-_52px),_transparent_calc(100%_-_14px))] [&:hover_.comments-chip-x]:opacity-100 [outline:0] relative"
              tabIndex={0}
              aria-label={t('{0} review {1} attached', {
                '0': items.length,
                '1': items.length === 1 ? t('comment') : t('comments'),
              })}
            />
          }
        >
          <span className="attachment-open file">
            <MessageSquareText size={15} />
            <span className="attachment-name [&_small]:block [&_small]:text-caption min-w-0 [overflow-wrap:anywhere]">
              {items.length} {items.length === 1 ? t('comment') : t('comments')}
            </span>
          </span>
          <Button
            variant="secondary"
            size="icon-xs"
            type="button"
            className="bg-fill hover:bg-fill-hover comments-chip-x [&:focus-visible]:opacity-100 [&:hover]:[background:linear-gradient(var(--hover),_var(--hover)),_linear-gradient(var(--pressed),_var(--pressed)),_var(--canvas)] absolute top-[50%] [transform:translateY(-50%)] grid place-items-center p-0 [border:0] rounded-full opacity-0 cursor-pointer [transition:opacity_0.12s_var(--ease)] w-[22px] h-[22px] right-[5px] [box-shadow:inset_0_0_0_1px_var(--line-strong)] text-foreground [background:linear-gradient(var(--pressed),_var(--pressed)),_var(--canvas)]"
            aria-label={t('Remove comments from this message')}
            title={t('Remove from this message')}
            onClick={onRemove}
          >
            <X size={13} />
          </Button>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="start"
          sideOffset={6}
          className="comments-popover relative z-30 max-h-[260px] overflow-y-auto [border:1px_solid_var(--edge)] p-1.5 w-[min(380px,_90vw)] rounded-(--radius-m) [background:color-mix(in_srgb,_var(--raised)_94%,_transparent)] [backdrop-filter:blur(14px)] [box-shadow:0_10px_32px_rgba(0,_0,_0,_0.45)]"
        >
          {items.map((item) => (
            <div
              key={item.id}
              className="comments-popover-item [&_+_.comments-popover-item]:[border-top:0] [&_+_.comments-popover-item]:mt-0.5 [&_p]:m-[4px_0_0] [&_p]:text-control [&_p]:leading-[1.45] [&_p]:whitespace-pre-wrap [&_p]:[overflow-wrap:anywhere] [&:hover]:bg-hover p-[6px_8px] rounded-(--radius-s)"
            >
              <div className="comments-popover-where [&_.review-note-where]:flex-none [&_.review-note-where]:cursor-default flex items-center gap-2 text-caption min-w-0">
                <span className="review-note-where [&:hover:not(:disabled)]:[background:color-mix(in_srgb,_var(--accent)_28%,_transparent)] [&:is(span)]:cursor-default p-[1px_7px] [border:0] rounded-(--radius-s) bg-brand-wash text-brand font-mono text-caption leading-[18px] cursor-pointer">
                  {item.label}
                </span>
                <span
                  className="comments-popover-file overflow-hidden text-ellipsis whitespace-nowrap min-w-0 text-muted-foreground"
                  title={item.path}
                >
                  {item.path}
                </span>
              </div>
              <p>{item.text}</p>
            </div>
          ))}
        </HoverCardContent>
      </div>
    </HoverCard>
  )
}

/** Comment cards inside a sent message, read back from the hidden review payload. */
export function sentComments(text: string): { path: string; label: string; text: string }[] {
  const body = text.match(/<review-comments>\s*([\s\S]*?)\s*<\/review-comments>/)?.[1]
  if (!body) return []
  try {
    return (
      JSON.parse(body) as {
        path: string
        side: 'old' | 'new'
        line: number
        endLine: number
        scope?: string
        originalComment: string
      }[]
    ).map((c) => ({ path: c.path, label: commentLabel(c.side, c.line, c.endLine, c.scope), text: c.originalComment }))
  } catch {
    return []
  }
}
