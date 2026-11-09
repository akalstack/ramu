import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import type { PullRequestFile, PullRequestThread, ReviewVerdict } from '@ramu/shared/types'
import { patchRows } from '@ramu/shared/pullRequests'
import { cn } from 'cn'
import { t } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { FileIcon } from '../editor/FileIcon'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../workspace/TaskPane'
import { queryInvokerFor } from './hostQuery'

/** Files that start open; a larger pull request starts folded so its list can be read first. */
const OPEN_AT_FIRST = 10

const STATUS_LABEL: Partial<Record<PullRequestFile['status'], string>> = {
  added: 'Added',
  removed: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
}

const VERDICTS: { value: ReviewVerdict; label: string; help: string }[] = [
  { value: 'comment', label: 'Comment', help: 'Submit general feedback without explicit approval.' },
  { value: 'approve', label: 'Approve', help: 'Submit feedback and approve merging these changes.' },
  {
    value: 'request-changes',
    label: 'Request changes',
    help: 'Submit feedback that must be addressed before merging.',
  },
]

interface Pending {
  id: string
  path: string
  line: number
  body: string
}

/** The files a pull request changes, as its service fetches them; shared by the tab and its count. */
export function usePullRequestFiles(taskId: string, repoId: string, url: string) {
  const host = useHost()
  const call = queryInvokerFor(host.id)
  return useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequestFiles', taskId, repoId, url),
    queryFn: () => call('forge.pullRequestFiles', taskId, repoId, url),
    staleTime: 60_000,
  })
}

/** A review thread shown under the line it is on. */
function InlineThread({ thread }: { thread: PullRequestThread }) {
  return (
    <div className="flex flex-col gap-1.5 border-y border-line bg-card px-3 py-2 font-sans">
      {thread.comments.map((comment) => (
        <div key={comment.id} className="text-control [overflow-wrap:anywhere] whitespace-pre-wrap">
          <span className="font-medium text-foreground">{comment.author ?? t('Someone')}</span>
          {comment.bot && <span className="ml-1 text-caption text-muted-foreground">{t('bot')}</span>}
          {thread.resolved && <span className="ml-1 text-caption text-muted-foreground">{t('Resolved')}</span>}
          <div className="text-soft">{comment.body}</div>
        </div>
      ))}
    </div>
  )
}

function FileDiff({
  file,
  threads,
  pending,
  canComment,
  onAdd,
  onRemove,
}: {
  file: PullRequestFile
  threads: PullRequestThread[]
  pending: Pending[]
  canComment: boolean
  onAdd: (line: number, body: string) => void
  onRemove: (id: string) => void
}) {
  const rows = useMemo(() => (file.patch ? patchRows(file.patch) : []), [file.patch])
  const [writing, setWriting] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const after = (line: number | undefined) => {
    if (line === undefined) return null
    const here = threads.filter((thread) => thread.line === line)
    const mine = pending.filter((comment) => comment.line === line)
    if (!here.length && !mine.length && writing !== line) return null
    return (
      <tr>
        <td colSpan={3} className="p-0">
          {here.map((thread) => (
            <InlineThread key={thread.id} thread={thread} />
          ))}
          {mine.map((comment) => (
            <div
              key={comment.id}
              className="flex items-start gap-2 border-y border-line bg-card px-3 py-2 font-sans text-control"
            >
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
                <span className="mr-1.5 rounded-full bg-fill px-1.5 text-caption text-muted-foreground">
                  {t('Pending')}
                </span>
                {comment.body}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('Remove comment')}
                title={t('Remove comment')}
                onClick={() => onRemove(comment.id)}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          {writing === line && (
            <div className="flex flex-col gap-2 border-y border-line bg-card px-3 py-2 font-sans">
              <Textarea
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('Leave a comment on line {0}', { '0': line })}
                className="min-h-16 text-control"
              />
              <div className="flex justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setWriting(null)}>
                  {t('Cancel')}
                </Button>
                <Button
                  size="sm"
                  disabled={!draft.trim()}
                  onClick={() => {
                    onAdd(line, draft.trim())
                    setDraft('')
                    setWriting(null)
                  }}
                >
                  {t('Add to review')}
                </Button>
              </div>
            </div>
          )}
        </td>
      </tr>
    )
  }
  if (!file.patch)
    return <p className="m-0 px-3 py-2 text-caption text-muted-foreground">{t('No diff to show for this file.')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[12px] leading-[20px]">
        <tbody>
          {rows.map((row, index) => (
            <Fragment key={index}>
              <tr
                className={cn(
                  'group/line',
                  row.kind === 'add' && 'bg-[color-mix(in_srgb,var(--ok)_12%,transparent)]',
                  row.kind === 'del' && 'bg-[color-mix(in_srgb,var(--bad)_12%,transparent)]',
                  row.kind === 'hunk' && 'bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] text-muted-foreground',
                )}
              >
                <td className="w-11 select-none px-2 text-right align-top text-muted-foreground/70 tabular-nums">
                  {row.old ?? ''}
                </td>
                <td className="relative w-11 select-none px-2 text-right align-top text-muted-foreground/70 tabular-nums">
                  {canComment && row.new !== undefined && (
                    <Button
                      variant="default"
                      size="icon-xs"
                      className="absolute top-0.5 -right-2.5 z-1 size-4 rounded-sm p-0 opacity-0 group-hover/line:opacity-100 focus-visible:opacity-100"
                      aria-label={t('Comment on line {0}', { '0': row.new })}
                      title={t('Comment on line {0}', { '0': row.new })}
                      onClick={() => {
                        setDraft('')
                        setWriting(row.new!)
                      }}
                    >
                      <Plus size={11} />
                    </Button>
                  )}
                  {row.new ?? ''}
                </td>
                <td className="whitespace-pre pr-3 pl-3 text-foreground">
                  <span className="mr-2 inline-block w-2 select-none text-muted-foreground">
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
                  </span>
                  {row.text || ' '}
                </td>
              </tr>
              {after(row.new)}
            </Fragment>
          ))}
        </tbody>
      </table>
      {file.truncated && (
        <p className="m-0 px-3 py-2 text-caption text-muted-foreground">
          {t('The rest of this diff is too long to show here.')}
        </p>
      )}
    </div>
  )
}

/**
 * Files changed, as the services' own review views show them: each file's diff with line numbers, the review comments
 * already on its lines, and a comment on any line of the new version, gathered into one review that is submitted as a
 * comment, an approval or a request for changes.
 */
export function PullRequestFiles({
  taskId,
  repoId,
  url,
  threads,
  canReview,
  own,
  onReviewed,
}: {
  taskId: string
  repoId: string
  url: string
  threads: PullRequestThread[]
  canReview: boolean
  /** The person's own pull request: services take a comment on it, never an approval or a request for changes. */
  own: boolean
  onReviewed: () => void
}) {
  const { invoke } = useHost()
  const files = usePullRequestFiles(taskId, repoId, url)
  const [closed, setClosed] = useState<Set<string> | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [finishing, setFinishing] = useState(false)
  const [verdict, setVerdict] = useState<ReviewVerdict>('comment')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = files.data
  if (files.isPending) return <p className="m-0 text-caption text-muted-foreground">{t('Loading files…')}</p>
  if (files.isError) return <p className="m-0 text-caption text-bad">{errorText(files.error)}</p>
  if (!data?.files.length)
    return <p className="m-0 text-caption text-muted-foreground">{t('No changed files to show.')}</p>
  const isClosed = (path: string, index: number) => (closed ? closed.has(path) : index >= OPEN_AT_FIRST)
  const toggle = (path: string, index: number) =>
    setClosed((current) => {
      const next = new Set(current ?? data.files.slice(OPEN_AT_FIRST).map((file) => file.path))
      if (isClosed(path, index)) next.delete(path)
      else next.add(path)
      return next
    })
  const added = data.files.reduce((sum, file) => sum + file.additions, 0)
  const removed = data.files.reduce((sum, file) => sum + file.deletions, 0)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('forge.submitReview', taskId, repoId, url, {
        verdict,
        body: body.trim(),
        comments: pending.map(({ path, line, body: text }) => ({ path, line, body: text })),
      })
      setPending([])
      setBody('')
      setFinishing(false)
      onReviewed()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-control text-muted-foreground tabular-nums">
          {t('{0} files', { '0': `${data.files.length}${data.more ? '+' : ''}` })} ·{' '}
          <span className="text-ok">+{added}</span> <span className="text-bad">−{removed}</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setClosed(new Set())}>
            {t('Expand all')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setClosed(new Set(data.files.map((file) => file.path)))}>
            {t('Collapse all')}
          </Button>
          {canReview && (
            <Button
              size="sm"
              variant={pending.length ? 'default' : 'secondary'}
              onClick={() => setFinishing((v) => !v)}
            >
              <MessageSquare size={13} />
              {t('Finish review')}
              {pending.length ? <span className="tabular-nums">· {pending.length}</span> : null}
            </Button>
          )}
        </div>
      </div>
      {finishing && (
        <div className="flex flex-col gap-2.5 rounded-(--radius-m) border border-line bg-card p-3">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('Leave a comment')}
            className="min-h-20 text-control"
          />
          <div role="radiogroup" aria-label={t('Review')} className="flex flex-col gap-1">
            {VERDICTS.filter((entry) => !own || entry.value === 'comment').map((entry) => (
              <Button
                key={entry.value}
                variant="ghost"
                role="radio"
                aria-checked={verdict === entry.value}
                className={cn(
                  'h-auto justify-start gap-2 px-2 py-1.5 text-left font-normal',
                  verdict === entry.value && 'bg-accent',
                )}
                onClick={() => setVerdict(entry.value)}
              >
                <span
                  className={cn(
                    'mt-0.5 size-3 flex-none self-start rounded-full border',
                    verdict === entry.value ? 'border-(--primary) bg-(--primary)' : 'border-line',
                  )}
                />
                <span className="flex flex-col">
                  <span className="text-control text-foreground">{t(entry.label)}</span>
                  <span className="text-caption text-muted-foreground">{t(entry.help)}</span>
                </span>
              </Button>
            ))}
          </div>
          {error && <p className="m-0 text-caption text-bad">{error}</p>}
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setFinishing(false)}>
              {t('Cancel')}
            </Button>
            <Button
              size="sm"
              disabled={busy || (verdict !== 'approve' && !body.trim() && !pending.length)}
              onClick={() => void submit()}
            >
              {busy ? t('Submitting…') : t('Submit review')}
            </Button>
          </div>
        </div>
      )}
      {data.files.map((file, index) => {
        const open = !isClosed(file.path, index)
        const status = STATUS_LABEL[file.status]
        const fileThreads = threads.filter((thread) => thread.path === file.path && !thread.outdated && thread.line)
        const filePending = pending.filter((comment) => comment.path === file.path)
        return (
          <section key={file.path} className="overflow-hidden rounded-(--radius-m) border border-line">
            <Button
              variant="ghost"
              className="h-auto w-full justify-start gap-2 rounded-none border-b border-line bg-card px-3 py-2 text-left font-normal hover:bg-hover"
              aria-expanded={open}
              onClick={() => toggle(file.path, index)}
            >
              <ChevronRight size={13} className={cn('flex-none transition-transform', open && 'rotate-90')} />
              <FileIcon path={file.path} size={14} className="flex-none" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" title={file.path}>
                {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
              </span>
              {fileThreads.length + filePending.length > 0 && (
                <span className="inline-flex flex-none items-center gap-0.5 text-caption text-muted-foreground">
                  <MessageSquare size={11} />
                  {fileThreads.length + filePending.length}
                </span>
              )}
              {status && <span className="flex-none text-caption text-muted-foreground">{t(status)}</span>}
              <span className="flex-none text-caption tabular-nums">
                <span className="text-ok">+{file.additions}</span> <span className="text-bad">−{file.deletions}</span>
              </span>
            </Button>
            {open && (
              <FileDiff
                file={file}
                threads={fileThreads}
                pending={filePending}
                canComment={canReview}
                onAdd={(line, text) =>
                  setPending((current) => [
                    ...current,
                    { id: `${file.path}:${line}:${Date.now()}`, path: file.path, line, body: text },
                  ])
                }
                onRemove={(id) => setPending((current) => current.filter((comment) => comment.id !== id))}
              />
            )}
          </section>
        )
      })}
      {data.more && (
        <p className="m-0 text-caption text-muted-foreground">
          {t('Showing the first {0} files. Open it on the hosting service for the rest.', { '0': data.files.length })}
        </p>
      )}
    </div>
  )
}
