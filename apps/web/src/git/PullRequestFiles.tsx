import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, MessageSquare, Plus, Trash2, WrapText } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { SearchField } from '@/components/search-field'
import { Textarea } from '@/components/ui/textarea'
import type {
  ForgeService,
  PullRequestFile,
  PullRequestThread,
  PullRequestWrite,
  ReviewVerdict,
} from '@ramu/shared/types'
import { reviewNeedsWords, reviewVerdicts } from '@ramu/shared/pullRequestReadiness'
import { diffLineMatches, matchesPullRequestFile, patchRows } from '@ramu/shared/pullRequests'
import { cn } from 'cn'
import { PullRequestMarkdown } from './PullRequestMarkdown'
import { t } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { FileIcon } from '../editor/FileIcon'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../workspace/TaskPane'
import { CommentForm } from '../changes/CommentForm'
import { ICON_BUTTON_CLASS, NOTE_CLASS, WHERE_CLASS } from '../changes/styles'
import { commentLabel } from './ReviewChip'
import { LargeDiffBanner } from '../changes/LargeDiffBanner'
import { useColorizedLines } from '../editor/colorize'
import { ReviewThread } from './ReviewThread'
import { isLargeDiff } from '@ramu/shared/largeDiff'
import { ReviewFileTree } from '../changes/ReviewFileTree'
import { useNearViewport } from '../lib/useNearViewport'
import { queryInvokerFor } from './hostQuery'

/** Files that start open; a larger pull request starts folded so its list can be read first. */
const OPEN_AT_FIRST = 10
const WRAP_KEY = 'ramu.pull-request-wrap'

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
  /** Where a comment on a block of lines starts. */
  startLine?: number
  body: string
}

/** The lines a comment covers, as the Changes tab labels them. */
const where = (start: number | undefined, end: number) => commentLabel('new', start ?? end, end)

/** The wrap choice last made on this device; storage may be unavailable, which leaves lines unwrapped. */
function savedWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) === '1'
  } catch {
    return false
  }
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

/** A file's path as the services show it: the folder quiet and cut first, the file name whole. */
function FilePath({ file }: { file: PullRequestFile }) {
  const slash = file.path.lastIndexOf('/')
  const folder = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const name = file.path.slice(slash + 1)
  return (
    <span className="flex min-w-0 flex-1 items-baseline font-mono text-[12px]" title={file.path}>
      {file.previousPath && (
        <span className="mr-1.5 min-w-0 shrink truncate text-muted-foreground line-through">{file.previousPath}</span>
      )}
      {/* Cut from the start, so the folders nearest the file stay readable. */}
      <span className="min-w-0 shrink truncate text-muted-foreground [direction:rtl]">
        <bdi>{folder}</bdi>
      </span>
      <span className="flex-none text-foreground">{name}</span>
    </span>
  )
}

/** The new lines a comment is being written on, with the line the pick started from. */
interface Range {
  anchor: number
  start: number
  end: number
}

function FileDiff({
  file,
  threads,
  pending,
  canComment,
  wrap,
  highlight,
  onAdd,
  onRemove,
  onWrite,
}: {
  file: PullRequestFile
  /** The Files search, whose words mark the lines that hold them. */
  highlight: string
  threads: PullRequestThread[]
  pending: Pending[]
  canComment: boolean
  wrap: boolean
  /** Posts a reply or a thread's status on the pull request now, outside the pending review. */
  onWrite: (write: PullRequestWrite) => Promise<boolean>
  onAdd: (line: number, startLine: number | undefined, body: string) => void
  onRemove: (id: string) => void
}) {
  const rows = useMemo(() => (file.patch ? patchRows(file.patch) : []), [file.patch])
  // Code lines are colored together, in order, so a string or comment spanning lines keeps its colors; hunk headers and
  // notes stay plain.
  const code = useMemo(() => {
    const at = new Map<number, number>()
    const text: string[] = []
    rows.forEach((row, index) => {
      if (row.kind === 'hunk' || row.kind === 'note') return
      at.set(index, text.length)
      text.push(row.text)
    })
    return { at, source: text.join('\n') }
  }, [rows])
  const colored = useColorizedLines(code.source, file.path.includes('.') ? file.path.split('.').pop() : undefined)
  // Each number column fits the file's largest line number (about 7.5px a digit in the 12px mono face) and its padding.
  const numberWidth = useMemo(() => {
    const largest = rows.reduce((most, row) => Math.max(most, row.old ?? 0, row.new ?? 0), 0)
    return `${String(largest).length * 7.5 + 22}px`
  }, [rows])
  // Lines are picked as in the Changes tab: press on a line number and drag, or click one and Shift-click another.
  const [range, setRange] = useState<Range | null>(null)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  // The form opens on release, as on GitHub, so the rows under the pointer stay put while a block is dragged out.
  const dragging = useRef(false)
  const [held, setHeld] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const up = () => {
      if (!dragging.current) return
      dragging.current = false
      setHeld(false)
      requestAnimationFrame(() => input.current?.focus())
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])
  const extend = (line: number) =>
    setRange(
      (current) =>
        current && {
          anchor: current.anchor,
          start: Math.min(current.anchor, line),
          end: Math.max(current.anchor, line),
        },
    )
  /** Starts or extends a pick; false when a written draft elsewhere has to be finished first. */
  const pick = (line: number, extending: boolean) => {
    if (extending && range) {
      extend(line)
      return true
    }
    if (draft.trim() && range) {
      setDraftError(t('Add or cancel your current draft before starting another comment.'))
      input.current?.focus()
      return false
    }
    setDraft('')
    setDraftError(null)
    setRange({ anchor: line, start: line, end: line })
    return true
  }
  const press = (line: number, event: PointerEvent<HTMLElement>) => {
    if (!canComment || event.button !== 0) return
    // Keeps the drag from selecting code text.
    event.preventDefault()
    if (pick(line, event.shiftKey)) {
      dragging.current = true
      setHeld(true)
    }
  }
  const inRange = (line: number | undefined) =>
    line !== undefined && !!range && line >= range.start && line <= range.end
  const after = (line: number | undefined) => {
    if (line === undefined) return null
    const here = threads.filter((thread) => thread.line === line)
    const mine = pending.filter((comment) => comment.line === line)
    const writing = !held && range?.end === line
    if (!here.length && !mine.length && !writing) return null
    return (
      <tr>
        <td colSpan={3} className="p-0">
          {/* As wide as the visible diff and pinned to its left, so a long line never pushes the form out of view. */}
          <div className="sticky left-0 w-[100cqw] px-3 font-sans">
            {here.map((thread) => (
              <div key={thread.id} className="my-2 whitespace-normal">
                <ReviewThread thread={thread} location={false} onWrite={canComment ? onWrite : undefined} />
              </div>
            ))}
            {mine.map((comment) => (
              <article key={comment.id} className={NOTE_CLASS}>
                <header>
                  <span className={WHERE_CLASS}>{where(comment.startLine, comment.line)}</span>
                  <span className="text-caption text-muted-foreground">{t('Pending')}</span>
                  <span className="min-w-0 flex-1" />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={ICON_BUTTON_CLASS}
                    aria-label={t('Remove comment')}
                    title={t('Remove comment')}
                    onClick={() => onRemove(comment.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </header>
                <PullRequestMarkdown>{comment.body}</PullRequestMarkdown>
              </article>
            ))}
            {writing && range && (
              <CommentForm
                inputRef={input}
                path={file.path}
                where={where(range.start, range.end)}
                editing={false}
                value={draft}
                unchanged={false}
                error={draftError}
                busy={false}
                hint={t('Goes into your review when you finish it.')}
                saveLabel={t('Add to review')}
                onChange={setDraft}
                onCancel={() => {
                  setRange(null)
                  setDraft('')
                  setDraftError(null)
                }}
                onSave={() => {
                  onAdd(range.end, range.start < range.end ? range.start : undefined, draft.trim())
                  setDraft('')
                  setDraftError(null)
                  setRange(null)
                }}
              />
            )}
          </div>
        </td>
      </tr>
    )
  }
  if (!file.patch)
    return (
      <p className="m-0 rounded-b-(--radius-m) border-x border-b border-line px-4 py-3 text-caption text-muted-foreground">
        {t('No diff to show for this file.')}
      </p>
    )
  return (
    <div className="@container overflow-x-auto rounded-b-(--radius-m) border-x border-b border-line">
      {/* Wrapping needs a table as wide as the pane with fixed number columns; unwrapped, it grows to the longest line. */}
      <table
        className={cn(
          'w-full border-collapse font-mono text-[12px] leading-[20px]',
          wrap ? 'table-fixed' : 'min-w-max',
        )}
      >
        {wrap && (
          <colgroup>
            <col style={{ width: numberWidth }} />
            <col style={{ width: numberWidth }} />
            <col />
          </colgroup>
        )}
        <tbody>
          {rows.map((row, index) =>
            row.kind === 'hunk' ? (
              <tr key={index} className="bg-[color-mix(in_srgb,var(--brand)_9%,transparent)] text-muted-foreground">
                <td
                  colSpan={3}
                  className={cn('px-4 py-1', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}
                >
                  {row.text}
                </td>
              </tr>
            ) : (
              <Fragment key={index}>
                <tr
                  className={cn(
                    'group/line',
                    row.kind === 'add' && 'bg-[color-mix(in_srgb,var(--ok)_12%,transparent)]',
                    row.kind === 'del' && 'bg-[color-mix(in_srgb,var(--bad)_12%,transparent)]',
                    diffLineMatches(row.text, highlight) && 'bg-[color-mix(in_srgb,var(--warn)_22%,transparent)]!',
                    inRange(row.new) && 'bg-(--accent-wash)!',
                  )}
                  onPointerEnter={() => {
                    if (dragging.current && row.new !== undefined) extend(row.new)
                  }}
                >
                  <td
                    className={cn(
                      'w-[1%] px-2.5 text-right align-top text-muted-foreground/70 tabular-nums select-none',
                      inRange(row.new) && 'shadow-[inset_3px_0_0_var(--brand)]',
                    )}
                  >
                    {row.old ?? ''}
                  </td>
                  <td
                    className={cn(
                      'relative w-[1%] px-2.5 text-right align-top text-muted-foreground/70 tabular-nums select-none',
                      canComment && row.new !== undefined && 'cursor-pointer hover:text-foreground',
                      inRange(row.new) && 'text-foreground',
                    )}
                    onPointerDown={row.new === undefined ? undefined : (event) => press(row.new!, event)}
                  >
                    {canComment && row.new !== undefined && !inRange(row.new) && (
                      <Button
                        variant="default"
                        size="icon-xs"
                        className="absolute top-0.5 -right-2 z-1 size-4 rounded-sm p-0 opacity-0 group-hover/line:opacity-100 focus-visible:opacity-100"
                        aria-label={t('Comment on line {0}', { '0': row.new })}
                        title={t('Click or drag to comment on lines')}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          press(row.new!, event)
                        }}
                        // Pointer presses are handled above; this is the keyboard's way in, Shift extending the block.
                        onClick={(event) => {
                          if (event.detail === 0 && pick(row.new!, event.shiftKey))
                            requestAnimationFrame(() => input.current?.focus())
                        }}
                      >
                        <Plus size={11} />
                      </Button>
                    )}
                    {row.new ?? ''}
                  </td>
                  <td
                    className={cn(
                      'pr-4 pl-3 text-foreground',
                      wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre',
                    )}
                  >
                    <span className="mr-2 inline-block w-2 text-muted-foreground select-none">
                      {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
                    </span>
                    {row.kind === 'note' ? (
                      <span className="text-muted-foreground">{row.text}</span>
                    ) : colored?.[code.at.get(index) ?? -1] !== undefined && row.text ? (
                      <span
                        className="monaco-colorized"
                        // Monaco's colorizer escapes the source and returns only its own token spans.
                        dangerouslySetInnerHTML={{ __html: colored[code.at.get(index)!]! }}
                      />
                    ) : (
                      row.text || ' '
                    )}
                  </td>
                </tr>
                {after(row.new)}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
      {file.truncated && (
        <p className="m-0 px-4 py-2 text-caption text-muted-foreground">
          {t('The rest of this diff is too long to show here.')}
        </p>
      )}
    </div>
  )
}

/** A file's diff, built once it nears the screen and kept after, so a long list opens fast and keeps its drafts. */
function NearFileDiff({ lines, children }: { lines: number; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const near = useNearViewport(root)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (near) setSeen(true)
  }, [near])
  return (
    <div ref={root}>
      {seen ? (
        children
      ) : (
        <div
          className="rounded-b-(--radius-m) border-x border-b border-line"
          style={{ height: Math.min(Math.max(lines, 1), 400) * 20 }}
        />
      )}
    </div>
  )
}

/**
 * Files changed, as the services' own review views show them: each file's diff with line numbers, the review comments
 * already on its lines, and a comment on any line or block of lines of the new version, gathered into one review that
 * is submitted as a comment, an approval or a request for changes. The toolbar and each file's header stay pinned while
 * its diff scrolls past.
 */
export function PullRequestFiles({
  taskId,
  repoId,
  url,
  threads,
  canReview,
  own,
  service,
  onReviewed,
}: {
  taskId: string
  repoId: string
  url: string
  threads: PullRequestThread[]
  canReview: boolean
  /** The person's own pull request: services take a comment on it, never an approval or a request for changes. */
  own: boolean
  service: ForgeService
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
  const [wrap, setWrap] = useState(savedWrap)
  // A large pull request is read one file at a time, as the Changes tab reads a large run.
  const [showAll, setShowAll] = useState(false)
  const [activePath, setActivePath] = useState<string | null>(null)
  // Files opened one at a time stay mounted, hidden, so a comment being written survives moving to another file.
  const [visited, setVisited] = useState<Set<string>>(() => new Set())
  const banner = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const data = files.data
  const wordless = reviewNeedsWords(service, verdict) && !body.trim() && !pending.length
  if (files.isPending) return <p className="m-0 text-caption text-muted-foreground">{t('Loading files…')}</p>
  if (files.isError) return <p className="m-0 text-caption text-bad">{errorText(files.error)}</p>
  if (!data?.files.length)
    return <p className="m-0 text-caption text-muted-foreground">{t('No changed files to show.')}</p>
  const added = data.files.reduce((sum, file) => sum + file.additions, 0)
  const removed = data.files.reduce((sum, file) => sum + file.deletions, 0)
  const large = isLargeDiff(data.files.length, added + removed)
  const oneAtATime = large && !showAll
  // A search narrows the list, the tree and Previous/Next to the files whose name or diff holds it.
  const list = query.trim() ? data.files.filter((file) => matchesPullRequestFile(file, query)) : data.files
  const activeIndex = Math.max(
    0,
    list.findIndex((file) => file.path === activePath),
  )
  const activeFile = list[activeIndex]
  // While searching, matching files open so the marked lines show without another click.
  const startsClosed = (index: number) => !oneAtATime && !query.trim() && index >= OPEN_AT_FIRST
  const isClosed = (path: string, index: number) => (closed ? closed.has(path) : startsClosed(index))
  const toggle = (path: string, index: number) =>
    setClosed((current) => {
      const next = new Set(current ?? list.filter((_, at) => startsClosed(at)).map((file) => file.path))
      if (isClosed(path, index)) next.delete(path)
      else next.add(path)
      return next
    })
  // One button expands every file while any is closed, and collapses them all once every one is open.
  const allOpen = list.every((file, index) => !isClosed(file.path, index))
  const pick = (path: string) => {
    if (oneAtATime) {
      setActivePath(path)
      setVisited((current) => new Set(current).add(path))
      // The bar above stays pinned, so scrolling to it would not move; the new file opens at its own top instead,
      // just under the pinned bars, once it is shown.
      requestAnimationFrame(() =>
        document.getElementById(`pull-request-file-${encodeURIComponent(path)}`)?.scrollIntoView({ block: 'start' }),
      )
    } else
      document
        .getElementById(`pull-request-file-${encodeURIComponent(path)}`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const counts = new Map<string, number>()
  for (const thread of threads)
    if (thread.path && !thread.outdated && thread.line) counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1)
  for (const comment of pending) counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('forge.submitReview', taskId, repoId, url, {
        verdict,
        body: body.trim(),
        comments: pending.map(({ path, line, startLine, body: text }) => ({
          path,
          line,
          ...(startLine ? { startLine } : {}),
          body: text,
        })),
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
  // Replies and resolving go to the pull request at once, unlike line comments, which wait for Finish review.
  const writeNow = async (change: PullRequestWrite) => {
    setError(null)
    try {
      await invoke('forge.pullRequestWrite', taskId, repoId, url, change)
      onReviewed()
      return true
    } catch (reason) {
      setError(errorText(reason))
      return false
    }
  }
  const toggleWrap = () =>
    setWrap((value) => {
      try {
        localStorage.setItem(WRAP_KEY, value ? '0' : '1')
      } catch {
        // The choice still applies until the view closes.
      }
      return !value
    })
  return (
    <div className="flex flex-col gap-3">
      {/* Pinned under the tabs (36px) at a fixed 48px, so the totals and Finish review stay in reach through a long diff
          and the file headers pin flush beneath it. */}
      <div className="sticky top-9 z-15 -mx-1 flex h-12 items-center gap-2 overflow-x-auto bg-canvas px-1">
        <span className="text-control text-muted-foreground tabular-nums">
          {query.trim()
            ? t('{0} of {1} files', { '0': list.length, '1': `${data.files.length}${data.more ? '+' : ''}` })
            : t('{0} files', { '0': `${data.files.length}${data.more ? '+' : ''}` })}{' '}
          · <span className="text-ok">+{added}</span> <span className="text-bad">−{removed}</span>
        </span>
        <SearchField
          value={query}
          onChange={setQuery}
          label={t('Search files and changes')}
          className="w-56 min-w-36 flex-initial"
          inputClassName="h-7"
        />
        <div className="ml-auto flex items-center gap-1">
          {/* View controls are icons with their name on hover, so the one action with words is Finish review. */}
          <div role="group" aria-label={t('Diff view')} className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-pressed={wrap}
              className={cn(ICON_BUTTON_CLASS, 'aria-pressed:bg-hover aria-pressed:text-foreground')}
              aria-label={wrap ? t('Stop wrapping long lines') : t('Wrap long lines')}
              title={wrap ? t('Stop wrapping long lines') : t('Wrap long lines')}
              onClick={toggleWrap}
            >
              <WrapText size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
              aria-label={allOpen ? t('Collapse all files') : t('Expand all files')}
              title={allOpen ? t('Collapse all files') : t('Expand all files')}
              onClick={() => setClosed(allOpen ? new Set(list.map((file) => file.path)) : new Set())}
            >
              {allOpen ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
            </Button>
          </div>
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
      {error && !finishing && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {finishing && (
        <div className="flex flex-col gap-2.5 rounded-(--radius-m) bg-card p-3">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('Leave a comment')}
            className="min-h-20 text-control"
          />
          <div role="radiogroup" aria-label={t('Review')} className="flex flex-col gap-1">
            {VERDICTS.filter((entry) => reviewVerdicts(service, own).includes(entry.value)).map((entry) => (
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
          <div className="flex items-center justify-end gap-1.5">
            {wordless && (
              <p className="m-0 mr-auto text-caption text-muted-foreground">
                {t(
                  verdict === 'request-changes' ? 'GitHub needs a comment to request changes.' : 'Add a comment first.',
                )}
              </p>
            )}
            <Button variant="ghost" size="sm" onClick={() => setFinishing(false)}>
              {t('Cancel')}
            </Button>
            <Button size="sm" disabled={busy || wordless} onClick={() => void submit()}>
              {busy ? t('Submitting…') : t('Submit review')}
            </Button>
          </div>
        </div>
      )}
      {/* The file list sits beside the diffs once a pull request is large and the pane is wide enough for both. */}
      <div className="@container">
        <div
          className={cn('grid gap-3', large && '@[760px]:grid-cols-[minmax(170px,220px)_minmax(0,1fr)]')}
          style={{ '--review-toolbar-height': '72px' } as React.CSSProperties}
        >
          {large && (
            <div className="hidden @[760px]:block">
              <ReviewFileTree
                files={list.map((file) => ({
                  id: file.path,
                  path: file.path,
                  addedLines: file.additions,
                  removedLines: file.deletions,
                }))}
                counts={counts}
                viewedFiles={new Set()}
                activeId={oneAtATime ? activeFile?.path : undefined}
                onPick={pick}
              />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-3">
            {!list.length && (
              <p className="m-0 text-caption text-muted-foreground">
                {t('No changed file or line matches “{0}”.', { '0': query.trim() })}
              </p>
            )}
            {large && list.length > 0 && (
              // Pinned under the toolbar while the diff scrolls, so the file count and Previous/Next stay in reach; file
              // headers pin beneath it (84px + its 52px).
              <div ref={banner} className="sticky top-[84px] z-12 h-[52px] scroll-mt-[84px] bg-canvas pb-2">
                <LargeDiffBanner
                  oneAtATime={oneAtATime}
                  activeIndex={activeIndex}
                  count={list.length}
                  onStep={(delta) => pick(list[activeIndex + delta]!.path)}
                  onToggleAll={() => setShowAll((value) => !value)}
                />
              </div>
            )}
            {list.map((file, index) => {
              const shown = !oneAtATime || file.path === activeFile?.path
              if (oneAtATime && !shown && !visited.has(file.path)) return null
              const open = !isClosed(file.path, index)
              const status = STATUS_LABEL[file.status]
              const fileThreads = threads.filter(
                (thread) => thread.path === file.path && !thread.outdated && thread.line,
              )
              const filePending = pending.filter((comment) => comment.path === file.path)
              return (
                // No overflow clipping here: it would stop the file's header from staying pinned while its diff scrolls.
                <section
                  key={file.path}
                  id={`pull-request-file-${encodeURIComponent(file.path)}`}
                  hidden={!shown}
                  className={large ? 'scroll-mt-[136px]' : 'scroll-mt-[84px]'}
                >
                  {/* Pinned under the tabs and the toolbar (36px + 48px), on the page's own colour so the diff never shows
                through the header's tint. */}
                  <div className={cn('sticky z-10 bg-canvas', large ? 'top-[136px]' : 'top-[84px]')}>
                    <Button
                      variant="ghost"
                      className={cn(
                        'h-auto w-full justify-start gap-2 border border-line bg-card px-3 py-2 text-left font-normal hover:bg-hover',
                        open ? 'rounded-t-(--radius-m) rounded-b-none' : 'rounded-(--radius-m)',
                      )}
                      aria-expanded={open}
                      onClick={() => toggle(file.path, index)}
                    >
                      <ChevronRight size={13} className={cn('flex-none transition-transform', open && 'rotate-90')} />
                      <FileIcon path={file.path} size={14} className="flex-none" />
                      <FilePath file={file} />
                      {fileThreads.length + filePending.length > 0 && (
                        <span className="inline-flex flex-none items-center gap-0.5 text-caption text-muted-foreground">
                          <MessageSquare size={11} />
                          {fileThreads.length + filePending.length}
                        </span>
                      )}
                      {status && <span className="flex-none text-caption text-muted-foreground">{t(status)}</span>}
                      <span className="flex-none text-caption tabular-nums">
                        <span className="text-ok">+{file.additions}</span>{' '}
                        <span className="text-bad">−{file.deletions}</span>
                      </span>
                    </Button>
                  </div>
                  {open && (
                    <NearFileDiff lines={file.additions + file.deletions}>
                      <FileDiff
                        file={file}
                        threads={fileThreads}
                        pending={filePending}
                        canComment={canReview}
                        wrap={wrap}
                        highlight={query}
                        onWrite={writeNow}
                        onAdd={(line, startLine, text) =>
                          setPending((current) => [
                            ...current,
                            {
                              id: `${file.path}:${line}:${Date.now()}`,
                              path: file.path,
                              line,
                              ...(startLine ? { startLine } : {}),
                              body: text,
                            },
                          ])
                        }
                        onRemove={(id) => setPending((current) => current.filter((comment) => comment.id !== id))}
                      />
                    </NearFileDiff>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      </div>
      {data.more && (
        <p className="m-0 text-caption text-muted-foreground">
          {t('Showing the first {0} files. Open it on the hosting service for the rest.', { '0': data.files.length })}
        </p>
      )}
    </div>
  )
}
