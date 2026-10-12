import { t, useLanguage } from './i18n'
import { Button } from '@/components/ui/button'
import { MessageSquareText, X } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import type { ChangeReview } from '../../shared/types'

export interface PendingComments { review: ChangeReview; ids: string[] }

/** Unsent review comments for a chat, newest revision first. */
export function pendingComments(reviews: ChangeReview[], sessionId: string): PendingComments[] {
  return reviews.filter((review) => review.sessionId === sessionId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((review) => ({ review, ids: review.comments.filter((c) => c.state === 'draft' && c.readyToSend !== false).map((c) => c.id) }))
    .filter((group) => group.ids.length > 0)
}

export const commentLabel = (side: 'old' | 'new', line: number, endLine: number, scope?: string) => scope === 'file' ? t('File') : `${side === 'old' ? 'L' : 'R'} ${line}${endLine !== line ? `–${endLine}` : ''}`

/** "2 comments" above the message box; hover for the list, × to take them off this message (they stay on the diff). */
export function CommentsChip({ groups, onRemove }: { groups: PendingComments[]; onRemove: () => void }) {
  useLanguage()
  const items = groups.flatMap((group) => group.ids.map((id) => {
    const comment = group.review.comments.find((c) => c.id === id)!
    const file = group.review.files.find((f) => f.id === comment.fileId)
    return { id, path: file?.path ?? 'file', label: commentLabel(comment.side, comment.line, comment.endLine, comment.scope), text: comment.text }
  }))
  if (!items.length) return null
  return <HoverCard><div className="comments-chip-wrap">
    <HoverCardTrigger delay={150} closeDelay={120} render={<span className="attachment-chip comments-chip" tabIndex={0} aria-label={t("{0} review {1} attached", { "0": items.length, "1": items.length === 1 ? t('comment') : t('comments') })} />}>
      <span className="attachment-open file"><MessageSquareText size={15} /><span className="attachment-name">{items.length} {items.length === 1 ? t("comment") : t("comments")}</span></span>
      <Button type="button" className="comments-chip-x" aria-label={t("Remove comments from this message")} title={t("Remove from this message")} onClick={onRemove}><X size={13} /></Button>
    </HoverCardTrigger>
    <HoverCardContent side="top" align="start" sideOffset={6} className="comments-popover">{items.map((item) => <div key={item.id} className="comments-popover-item">
      <div className="comments-popover-where"><span className="review-note-where">{item.label}</span><span className="comments-popover-file" title={item.path}>{item.path}</span></div>
      <p>{item.text}</p>
    </div>)}</HoverCardContent>
  </div></HoverCard>
}

/** Comment cards inside a sent message, read back from the hidden review payload. */
export function sentComments(text: string): { path: string; label: string; text: string }[] {
  const body = text.match(/<review-comments>\s*([\s\S]*?)\s*<\/review-comments>/)?.[1]
  if (!body) return []
  try {
    return (JSON.parse(body) as { path: string; side: 'old' | 'new'; line: number; endLine: number; scope?: string; originalComment: string }[])
      .map((c) => ({ path: c.path, label: commentLabel(c.side, c.line, c.endLine, c.scope), text: c.originalComment }))
  } catch { return [] }
}
