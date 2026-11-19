import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight, ListTree, MessageSquare, WrapText } from 'lucide-react-native'
import type { PullRequestFile, PullRequestThread } from '@ramu/shared/types'
import { patchRows } from '@ramu/shared/pullRequests'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { Button, Card, Divider, IconButton, Pill, T, tap } from './ui'
import { FileJumpSheet, LargeDiffBar } from './LargeDiff'
import { isLargeDiff } from '@ramu/shared/largeDiff'
import { DiffLines } from './DiffLines'
import { PullRequestMarkdown } from './PullRequestMarkdown'
import { patchDiffLines } from '../runtime/diff'
import type { DiffLine } from '../runtime/types'
import { commentLines, type PendingComment } from './PullRequestReview'
import { useStore } from '../runtime/store'

/** The phone's choice to wrap long diff lines, kept on this device as the desktop keeps its own. */
const WRAP_KEY = 'pr-diff-wrap'

/** Files that start open; a larger pull request starts folded so its list reads first. */
const OPEN_AT_FIRST = 5

function FilePatch({
  file,
  threads,
  pending,
  onComment,
  onEditPending,
  wrap,
}: {
  file: PullRequestFile
  threads: PullRequestThread[]
  pending: PendingComment[]
  /** A comment on `line`, or on `startLine` to `line` for a block of lines. */
  onComment?: (line: number, startLine?: number) => void
  onEditPending?: (comment: PendingComment) => void
  wrap: boolean
}) {
  const { c } = useTheme()
  const say = useSay()
  const lines = useMemo(() => (file.patch ? patchDiffLines(patchRows(file.patch)) : []), [file.patch])
  // A long-pressed line starts a block of lines; the next line tapped ends it, as dragging does on the desktop.
  const [anchor, setAnchor] = useState<number | null>(null)
  if (!file.patch)
    return (
      <T size={font.caption} tone="muted" style={{ padding: space.m }}>
        {say('No diff to show for this file.')}
      </T>
    )
  // A line on the new side takes a comment, as the services comment on the new version.
  const commentable = (line: DiffLine) => (line.type === 'add' || line.type === 'ctx' ? line.new : undefined)
  return (
    <View style={{ padding: space.s, gap: space.xs }}>
      {anchor !== null ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s,
            paddingLeft: space.m,
            borderRadius: radius.s,
            backgroundColor: c.accentSoft,
          }}
        >
          <T size={font.caption} tone="accent" style={{ flex: 1 }}>
            {say('From line {0}: tap the last line to comment on', { 0: anchor })}
          </T>
          <Button kind="ghost" title={say('Cancel')} onPress={() => setAnchor(null)} />
        </View>
      ) : null}
      <DiffLines
        file={{ path: file.path, lines }}
        wrap={wrap}
        selected={anchor}
        marked={new Set(threads.map((thread) => `new:${thread.line}`))}
        lineLabel={(line) =>
          commentable(line) !== undefined && onComment
            ? say('Comment on line {0}', { 0: commentable(line)! })
            : `${line.new ?? line.old ?? ''}`
        }
        onLine={
          onComment
            ? (row) => {
                const line = commentable(row)
                if (line === undefined) return
                tap()
                if (anchor !== null && anchor !== line) onComment(Math.max(anchor, line), Math.min(anchor, line))
                else onComment(line)
                setAnchor(null)
              }
            : undefined
        }
        onLongLine={
          onComment
            ? (row) => {
                const line = commentable(row)
                if (line === undefined) return
                tap()
                setAnchor(line)
              }
            : undefined
        }
        after={(row) => {
          if (row.new === undefined || row.type === 'del' || row.type === 'hunk') return null
          const here = threads.filter((thread) => thread.line === row.new)
          const waiting = pending.filter((comment) => comment.line === row.new)
          if (!here.length && !waiting.length) return null
          return (
            <View style={{ gap: space.xs, paddingVertical: space.xs, paddingLeft: 48, paddingRight: space.s }}>
              {here.map((thread) => (
                <View
                  key={thread.id}
                  style={{
                    gap: 4,
                    padding: space.s,
                    borderRadius: radius.s,
                    backgroundColor: c.raised2,
                    maxWidth: 360,
                  }}
                >
                  {thread.comments.map((comment) => (
                    <View key={comment.id} style={{ gap: 2 }}>
                      <T size={font.caption} weight="600">
                        {comment.author ?? say('Someone')}
                      </T>
                      <PullRequestMarkdown text={comment.body} />
                    </View>
                  ))}
                </View>
              ))}
              {waiting.map((comment) => (
                <Pressable
                  key={comment.id}
                  disabled={!onEditPending}
                  accessibilityRole={onEditPending ? 'button' : undefined}
                  accessibilityLabel={onEditPending ? say('Edit comment') : undefined}
                  onPress={() => {
                    tap()
                    onEditPending?.(comment)
                  }}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.7 : 1,
                    gap: 2,
                    padding: space.s,
                    backgroundColor: c.accentSoft,
                    borderRadius: radius.s,
                    maxWidth: 360,
                  })}
                >
                  <T size={font.caption} tone="accent" weight="600">
                    {[commentLines(say, comment), say('Pending'), onEditPending ? say('Tap to edit') : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </T>
                  <T size={font.caption}>{comment.body}</T>
                </Pressable>
              ))}
            </View>
          )
        }}
      />
      {file.truncated ? (
        <T size={font.caption} tone="muted" style={{ padding: space.s }}>
          {say('The rest of this diff is too long to show here.')}
        </T>
      ) : null}
    </View>
  )
}

/** The status letter the thread's changes show beside a file. */
const STATUS_LETTER: Record<PullRequestFile['status'], 'M' | 'A' | 'D' | 'R'> = {
  added: 'A',
  copied: 'A',
  removed: 'D',
  renamed: 'R',
  modified: 'M',
  changed: 'M',
  unchanged: 'M',
}

/**
 * Files changed, as on the desktop and the services: each file with its counts and the review comments on it, opening
 * to its diff with the comments under the lines they are on.
 */
export function PullRequestFilesList({
  files,
  more,
  threads,
  pending = [],
  onComment,
  onEditPending,
  focus,
  onReveal,
}: {
  files: PullRequestFile[]
  more: boolean
  threads: PullRequestThread[]
  /** Line comments waiting to go out with the person's review. */
  pending?: PendingComment[]
  /** With it, a line on the new side opens a comment for the review; `startLine` begins a block of lines. */
  onComment?: (path: string, line: number, startLine?: number) => void
  /** With it, a pending comment opens to be edited or removed. */
  onEditPending?: (comment: PendingComment) => void
  /** A file a link led to: it opens, and `onReveal` scrolls the page to it (`key` changes for each new request). */
  focus?: { path: string; key: number } | null
  /** Scrolls the page so a file measured at `y` (window coordinates) sits near the top. */
  onReveal?: (y: number) => void
}) {
  const { c } = useTheme()
  const say = useSay()
  const store = useStore()
  const wrap = store.drafts[WRAP_KEY] === '1'
  const added = files.reduce((sum, file) => sum + file.additions, 0)
  const removed = files.reduce((sum, file) => sum + file.deletions, 0)
  // A large change shows one file at a time, as on the desktop, so hundreds of files never mount their diffs at once.
  const large = isLargeDiff(files.length, added + removed)
  const [showAll, setShowAll] = useState(false)
  const oneAtATime = large && !showAll
  const [active, setActive] = useState(0)
  const [jumping, setJumping] = useState(false)
  // Diffs draw only for open files; a large change starts with every file folded.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(large ? [] : files.slice(0, OPEN_AT_FIRST).map((file) => file.path)),
  )
  const allOpen = files.every((file) => open.has(file.path))
  const [target, setTarget] = useState<{ path: string; key: number } | null>(null)
  const focused = useRef<ComponentRef<typeof View>>(null)
  const goTo = (path: string) => {
    const index = files.findIndex((file) => file.path === path)
    if (index < 0) return
    if (oneAtATime) setActive(index)
    else setOpen((current) => new Set(current).add(path))
    setTarget({ path, key: Date.now() })
  }
  useEffect(() => {
    if (focus) goTo(focus.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs for each new link (`focus.key`)
  }, [focus?.key])
  useEffect(() => {
    if (!target) return
    // Measured once the opened diff has laid out, as a found setting is.
    const timer = setTimeout(() => focused.current?.measureInWindow((_x, y) => onReveal?.(y)), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs for each new jump (`target.key`)
  }, [target?.key])
  const counts = useMemo(() => {
    const found = new Map<string, number>()
    for (const thread of threads)
      if (thread.path && !thread.outdated && thread.line) found.set(thread.path, (found.get(thread.path) ?? 0) + 1)
    for (const comment of pending) found.set(comment.path, (found.get(comment.path) ?? 0) + 1)
    return found
  }, [threads, pending])
  const current = oneAtATime ? files[Math.min(active, files.length - 1)] : undefined
  const shownFiles = current ? [current] : files
  return (
    <View style={{ gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <T size={font.control} tone="muted" style={{ flex: 1 }}>
          {`${say('{0} files', { 0: `${files.length}${more ? '+' : ''}` })} · `}
          <T size={font.control} tone="ok">{`+${added}`}</T> <T size={font.control} tone="bad">{`−${removed}`}</T>
        </T>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={say('Wrap long lines')}
          accessibilityState={{ checked: wrap }}
          hitSlop={8}
          onPress={() => {
            tap()
            store.setDraft(WRAP_KEY, wrap ? '' : '1')
          }}
          style={({ pressed }) => ({
            padding: space.xs,
            borderRadius: radius.s,
            backgroundColor: wrap ? c.accentSoft : pressed ? c.pressed : 'transparent',
          })}
        >
          <WrapText size={16} color={wrap ? c.accent : c.muted} />
        </Pressable>
        {!large && files.length > OPEN_AT_FIRST ? (
          <IconButton
            icon={ListTree}
            label={say('Jump to file')}
            size={32}
            tone="muted"
            onPress={() => setJumping(true)}
          />
        ) : null}
        {!oneAtATime ? (
          <Button
            kind="ghost"
            title={say(allOpen ? 'Collapse all' : 'Expand all')}
            onPress={() => setOpen(allOpen ? new Set() : new Set(files.map((file) => file.path)))}
          />
        ) : null}
      </View>
      {large ? (
        <LargeDiffBar
          oneAtATime={oneAtATime}
          index={Math.min(active, files.length - 1)}
          count={files.length}
          onStep={(delta) => {
            const next = Math.max(0, Math.min(files.length - 1, active + delta))
            setActive(next)
            setTarget({ path: files[next]!.path, key: Date.now() })
          }}
          onToggleAll={() => setShowAll((value) => !value)}
          onJump={() => setJumping(true)}
        />
      ) : null}
      <FileJumpSheet
        open={jumping}
        files={files}
        counts={counts}
        current={current?.path}
        onPick={(path) => setTimeout(() => goTo(path), 300)}
        onClose={() => setJumping(false)}
      />
      {shownFiles.map((file) => {
        // One file at a time always shows its diff.
        const expanded = oneAtATime || open.has(file.path)
        const fileThreads = threads.filter((thread) => thread.path === file.path && !thread.outdated && thread.line)
        const filePending = pending.filter((comment) => comment.path === file.path)
        const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''
        const name = file.path.slice(dir.length)
        const letter = STATUS_LETTER[file.status]
        const [tone, wash] =
          letter === 'A'
            ? (['ok', c.okWash] as const)
            : letter === 'D'
              ? (['bad', c.badWash] as const)
              : (['warn', c.warnWash] as const)
        return (
          <View
            key={file.path}
            ref={target?.path === file.path || oneAtATime ? focused : undefined}
            collapsable={false}
          >
            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${file.path}, +${file.additions} −${file.deletions}`}
                disabled={oneAtATime}
                onPress={() => {
                  tap()
                  setOpen((current) => {
                    const next = new Set(current)
                    if (next.has(file.path)) next.delete(file.path)
                    else next.add(file.path)
                    return next
                  })
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  padding: space.m,
                  backgroundColor: pressed ? c.pressed : 'transparent',
                })}
              >
                {expanded ? <ChevronDown size={15} color={c.muted} /> : <ChevronRight size={15} color={c.muted} />}
                <Pill tone={tone} wash={wash}>
                  {letter}
                </Pill>
                <View style={{ flex: 1 }}>
                  <T size={font.body - 1} weight="500" numberOfLines={1}>
                    {name}
                  </T>
                  {dir || file.previousPath ? (
                    <T size={font.caption} tone="muted" numberOfLines={1}>
                      {file.previousPath && file.previousPath !== file.path ? `${file.previousPath} → ` : ''}
                      {dir}
                    </T>
                  ) : null}
                </View>
                {fileThreads.length + filePending.length ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <MessageSquare size={11} color={c.muted} />
                    <T size={font.caption} tone="muted">
                      {String(fileThreads.length + filePending.length)}
                    </T>
                  </View>
                ) : null}
                <T size={font.caption + 1} mono tone="ok">
                  +{file.additions}
                </T>
                <T size={font.caption + 1} mono tone="bad">
                  −{file.deletions}
                </T>
              </Pressable>
              {expanded ? (
                <>
                  <Divider />
                  <FilePatch
                    file={file}
                    threads={fileThreads}
                    pending={filePending}
                    onComment={onComment ? (line, startLine) => onComment(file.path, line, startLine) : undefined}
                    onEditPending={onEditPending}
                    wrap={wrap}
                  />
                </>
              ) : null}
            </Card>
          </View>
        )
      })}
      {more ? (
        <T size={font.caption} tone="muted">
          {say('Showing the first {0} files. Open it on the hosting service for the rest.', { 0: files.length })}
        </T>
      ) : null}
    </View>
  )
}
