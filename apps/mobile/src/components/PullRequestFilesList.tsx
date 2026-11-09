import { Fragment, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { MessageSquare } from 'lucide-react-native'
import type { PullRequestFile, PullRequestThread } from '@ramu/shared/types'
import { patchRows } from '@ramu/shared/pullRequests'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { Disclosure } from './Motion'
import { FileIcon } from './FileIcon'
import { T, tap } from './ui'
import type { PendingComment } from './PullRequestReview'

/** Files that start open; a larger pull request starts folded so its list reads first. */
const OPEN_AT_FIRST = 5

function FilePatch({
  file,
  threads,
  pending,
  onComment,
  onEditPending,
}: {
  file: PullRequestFile
  threads: PullRequestThread[]
  pending: PendingComment[]
  onComment?: (line: number) => void
  onEditPending?: (comment: PendingComment) => void
}) {
  const { c } = useTheme()
  const say = useSay()
  const rows = useMemo(() => (file.patch ? patchRows(file.patch) : []), [file.patch])
  if (!file.patch)
    return (
      <T size={font.caption} tone="muted" style={{ padding: space.m }}>
        {say('No diff to show for this file.')}
      </T>
    )
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ paddingVertical: space.xs, minWidth: '100%' }}>
        {rows.map((row, index) => {
          const here = row.new === undefined ? [] : threads.filter((thread) => thread.line === row.new)
          const waiting = row.new === undefined ? [] : pending.filter((comment) => comment.line === row.new)
          // A line on the new side takes a comment, as the services comment on the new version.
          const line = row.kind !== 'hunk' && row.kind !== 'del' ? row.new : undefined
          return (
            <Fragment key={index}>
              <Pressable
                disabled={!onComment || line === undefined}
                accessibilityRole={onComment && line !== undefined ? 'button' : undefined}
                accessibilityLabel={
                  onComment && line !== undefined ? say('Comment on line {0}', { 0: line }) : undefined
                }
                onPress={() => {
                  if (line === undefined) return
                  tap()
                  onComment?.(line)
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  backgroundColor:
                    row.kind === 'add'
                      ? 'rgba(52,199,89,0.14)'
                      : row.kind === 'del'
                        ? 'rgba(255,69,58,0.14)'
                        : row.kind === 'hunk'
                          ? c.fill
                          : 'transparent',
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <T size={11} mono tone="placeholder" style={{ width: 34, textAlign: 'right', paddingRight: 6 }}>
                  {row.new ?? row.old ?? ''}
                </T>
                <T size={11} mono tone={row.kind === 'hunk' ? 'muted' : 'body'} style={{ paddingRight: space.m }}>
                  {`${row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '} ${row.text}`}
                </T>
              </Pressable>
              {here.map((thread) => (
                <View
                  key={thread.id}
                  style={{ gap: 4, padding: space.s, marginVertical: 2, backgroundColor: c.raised2, maxWidth: 360 }}
                >
                  {thread.comments.map((comment) => (
                    <T key={comment.id} size={font.caption}>
                      <T size={font.caption} weight="600">
                        {comment.author ?? say('Someone')}
                      </T>
                      {` ${comment.body}`}
                    </T>
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
                    marginVertical: 2,
                    backgroundColor: c.accentSoft,
                    borderRadius: radius.s,
                    maxWidth: 360,
                  })}
                >
                  <T size={font.caption} tone="accent" weight="600">
                    {onEditPending ? `${say('Pending')} · ${say('Tap to edit')}` : say('Pending')}
                  </T>
                  <T size={font.caption}>{comment.body}</T>
                </Pressable>
              ))}
            </Fragment>
          )
        })}
        {file.truncated ? (
          <T size={font.caption} tone="muted" style={{ padding: space.s }}>
            {say('The rest of this diff is too long to show here.')}
          </T>
        ) : null}
      </View>
    </ScrollView>
  )
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
}: {
  files: PullRequestFile[]
  more: boolean
  threads: PullRequestThread[]
  /** Line comments waiting to go out with the person's review. */
  pending?: PendingComment[]
  /** With it, a line on the new side opens a comment for the review. */
  onComment?: (path: string, line: number) => void
  /** With it, a pending comment opens to be edited or removed. */
  onEditPending?: (comment: PendingComment) => void
}) {
  const { c } = useTheme()
  const say = useSay()
  const [open, setOpen] = useState<Set<string>>(() => new Set(files.slice(0, OPEN_AT_FIRST).map((file) => file.path)))
  const added = files.reduce((sum, file) => sum + file.additions, 0)
  const removed = files.reduce((sum, file) => sum + file.deletions, 0)
  return (
    <View style={{ gap: space.s }}>
      <T size={font.control} tone="muted">
        {`${say('{0} files', { 0: `${files.length}${more ? '+' : ''}` })} · `}
        <T size={font.control} tone="ok">{`+${added}`}</T> <T size={font.control} tone="bad">{`−${removed}`}</T>
      </T>
      {files.map((file) => {
        const expanded = open.has(file.path)
        const fileThreads = threads.filter((thread) => thread.path === file.path && !thread.outdated && thread.line)
        const filePending = pending.filter((comment) => comment.path === file.path)
        return (
          <View
            key={file.path}
            style={{ borderRadius: radius.m, borderWidth: 0.5, borderColor: c.lineStrong, overflow: 'hidden' }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${file.path}, +${file.additions} −${file.deletions}`}
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
                backgroundColor: pressed ? c.pressed : c.raised2,
              })}
            >
              <Disclosure open={expanded} size={13} color={c.muted} />
              <FileIcon path={file.path} size={14} />
              <T size={font.caption} mono numberOfLines={1} style={{ flex: 1 }}>
                {file.path}
              </T>
              {fileThreads.length + filePending.length ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <MessageSquare size={11} color={c.muted} />
                  <T size={font.caption} tone="muted">
                    {String(fileThreads.length + filePending.length)}
                  </T>
                </View>
              ) : null}
              <T size={font.caption} tone="ok">{`+${file.additions}`}</T>
              <T size={font.caption} tone="bad">{`−${file.deletions}`}</T>
            </Pressable>
            {expanded ? (
              <FilePatch
                file={file}
                threads={fileThreads}
                pending={filePending}
                onComment={onComment ? (line) => onComment(file.path, line) : undefined}
                onEditPending={onEditPending}
              />
            ) : null}
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
