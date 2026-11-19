import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { PullRequestComment, PullRequestThread, PullRequestWrite } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { cn } from 'cn'
import { timeAgo } from '../Menu'
import { t, useLanguage } from '../i18n'
import { CommentAvatar } from './CommentAvatar'
import { PullRequestMarkdown } from './PullRequestMarkdown'
import { ThreadReply } from './ThreadReply'

function CommentHead({ comment, size, actions }: { comment: PullRequestComment; size: number; actions?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <CommentAvatar name={comment.author} url={comment.avatarUrl} bot={comment.bot} size={size} />
      <span className="truncate text-control font-medium text-foreground">{comment.author ?? t('Someone')}</span>
      {comment.bot && (
        <span className="flex-none rounded-full border border-line px-1.5 text-caption text-muted-foreground">
          {t('bot')}
        </span>
      )}
      {!comment.trusted && <span className="flex-none text-caption text-warn">{t('From outside the project')}</span>}
      {comment.createdAt > 0 && (
        <time
          className="flex-none text-caption text-muted-foreground"
          dateTime={new Date(comment.createdAt).toISOString()}
          title={new Date(comment.createdAt).toLocaleString()}
        >
          {timeAgo(comment.createdAt)}
        </time>
      )}
      {actions && <span className="ml-auto flex-none">{actions}</span>}
    </div>
  )
}

/**
 * One review thread, the same on the Overview and under its line in Files changed: where it is, whether it is
 * resolved (a resolved thread starts folded), the first comment, its replies hung from a line beneath it, and a reply
 * box with Resolve. It reads apart from comments on the pull request itself, which have no location or replies.
 */
export function ReviewThread({
  thread,
  location = true,
  onWrite,
  commentActions,
}: {
  thread: PullRequestThread
  /** Show the file and line; under the line itself only the line is needed. */
  location?: boolean
  /** Posts a reply or the thread's status; absent where the person cannot write here. */
  onWrite?: (write: PullRequestWrite) => Promise<boolean>
  commentActions?: (comment: PullRequestComment) => ReactNode
}) {
  useLanguage()
  const [open, setOpen] = useState(!thread.resolved)
  const [first, ...replies] = thread.comments
  const where = thread.path
    ? location
      ? `${thread.path}${thread.line ? `:${thread.line}` : ''}`
      : thread.line
        ? t('Comment on line {0}', { '0': thread.line })
        : t('Comment on this file')
    : t('Review comment')
  return (
    <article className="overflow-hidden rounded-(--radius-m) border border-line bg-card">
      <Button
        variant="ghost"
        aria-expanded={open}
        className="h-auto w-full justify-start gap-2 rounded-none border-b border-line px-3 py-1.5 text-left font-normal hover:bg-hover"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          size={13}
          className={cn('flex-none text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className={cn('min-w-0 flex-1 truncate text-caption text-muted-foreground', location && 'font-mono')}>
          {where}
        </span>
        {!open && first && (
          <span className="min-w-0 max-w-[40%] truncate text-caption text-muted-foreground">
            {first.author} ·{' '}
            {thread.comments.length === 1 ? t('1 comment') : t('{0} comments', { '0': thread.comments.length })}
          </span>
        )}
        {thread.outdated && (
          <span className="flex-none rounded-full border border-line px-2 text-caption text-muted-foreground">
            {t('Outdated')}
          </span>
        )}
        {thread.resolved && (
          <span className="flex-none rounded-full border border-line px-2 text-caption text-muted-foreground">
            {t('Resolved')}
          </span>
        )}
      </Button>
      {open && first && (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1.5">
            <CommentHead comment={first} size={26} actions={commentActions?.(first)} />
            <div className="min-w-0 pl-[34px]">
              <PullRequestMarkdown>{first.body}</PullRequestMarkdown>
            </div>
          </div>
          {replies.length > 0 && (
            // Replies hang from a line under the first comment's picture, as one conversation.
            <div className="ml-[12px] flex flex-col gap-3 border-l border-line pl-[21px]">
              {replies.map((reply) => (
                <div key={reply.id} className="flex flex-col gap-1">
                  <CommentHead comment={reply} size={22} actions={commentActions?.(reply)} />
                  <div className="min-w-0 pl-[30px]">
                    <PullRequestMarkdown>{reply.body}</PullRequestMarkdown>
                  </div>
                </div>
              ))}
            </div>
          )}
          {onWrite && (
            <ThreadReply
              resolved={thread.resolved}
              resolvable={thread.resolvable}
              onReply={(body) => onWrite({ kind: 'reply', threadId: thread.id, body })}
              onStatus={(resolve) =>
                onWrite({ kind: 'thread-status', threadId: thread.id, status: resolve ? 'resolved' : 'active' })
              }
            />
          )}
        </div>
      )}
    </article>
  )
}
