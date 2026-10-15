import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeFile, ChangeReview } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { SearchInput } from '../SearchInput'
import { VirtualList } from '../lib/VirtualList'
import { useAppSettings } from '../settings/AppSettings'
import { DISCUSSION_COUNT_CLASS } from './styles'

/** File list beside the diffs: click to jump to a file, or to open it when the diff is shown one file at a time. */
export function ReviewFileTree({
  review,
  activeId,
  onPick,
  viewedFiles,
}: {
  viewedFiles: Set<string>
  review: ChangeReview
  activeId?: string
  onPick: (fileId: string) => void
}) {
  useLanguage()
  const [filter, setFilter] = useState(''),
    [closed, setClosed] = useState<Set<string>>(new Set())
  type Node = { name: string; path: string; dirs: Map<string, Node>; files: ChangeFile[] }
  const { preferences } = useAppSettings()
  const needle = useDeferredValue(filter).trim().toLowerCase()
  const treeRoot = useRef<HTMLElement>(null)
  const [flat, setFlat] = useState(false)
  useLayoutEffect(() => {
    const element = treeRoot.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFlat(entry.contentRect.width < 220)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const tree = useMemo(() => {
    const root: Node = { name: '', path: '', dirs: new Map(), files: [] }
    for (const file of review.files) {
      if (needle && !file.path.toLowerCase().includes(needle)) continue
      const parts = file.path.split('/')
      let node = root
      for (const part of parts.slice(0, -1)) {
        const path = node.path ? `${node.path}/${part}` : part
        if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path, dirs: new Map(), files: [] })
        node = node.dirs.get(part)!
      }
      node.files.push(file)
    }
    return root
  }, [review.files, needle])
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const comment of review.comments)
      if (comment.state === 'draft') map.set(comment.fileId, (map.get(comment.fileId) ?? 0) + 1)
    return map
  }, [review.comments])
  type Row = { key: string; depth: number; dir: Node; open: boolean } | { key: string; depth: number; file: ChangeFile }
  const rows = useMemo(() => {
    const result: Row[] = []
    if (flat)
      return review.files
        .filter((file) => !needle || file.path.toLowerCase().includes(needle))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => ({ key: `file:${file.id}`, depth: 0, file }))
    const visit = (node: Node, depth: number) => {
      for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const open = !!needle || !closed.has(dir.path)
        result.push({ key: `dir:${dir.path}`, depth, dir, open })
        if (open) visit(dir, depth + 1)
      }
      for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path)))
        result.push({ key: `file:${file.id}`, depth, file })
    }
    visit(tree, 0)
    return result
  }, [tree, closed, needle, flat, review.files])
  const render = (row: Row) =>
    'dir' in row ? (
      <Button
        variant="tree"
        type="button"
        className="review-tree-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.active]:bg-accent [&.active]:text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground [&_.review-tree-viewed]:text-ok flex items-center gap-[5px] w-full min-h-[26px] p-[0_8px] [border:0] rounded-(--radius-s) bg-transparent text-soft text-caption text-left cursor-pointer dir"
        style={{ paddingLeft: 8 + row.depth * 12 }}
        aria-expanded={row.open}
        onClick={() =>
          setClosed((current) => {
            const next = new Set(current)
            next.has(row.dir.path) ? next.delete(row.dir.path) : next.add(row.dir.path)
            return next
          })
        }
      >
        {row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="review-tree-name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {row.dir.name}
        </span>
      </Button>
    ) : (
      <Button
        variant="tree"
        type="button"
        className={`review-tree-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&.active]:bg-accent [&.active]:text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground [&_.review-tree-viewed]:text-ok flex items-center gap-[5px] w-full min-h-[26px] p-[0_8px] [border:0] rounded-(--radius-s) bg-transparent text-soft text-caption text-left cursor-pointer file${activeId === row.file.id ? ' active' : ''}`}
        style={{ paddingLeft: flat ? 8 : 8 + row.depth * 12 + 17 }}
        title={row.file.path}
        onClick={() => onPick(row.file.id)}
      >
        <span className="review-tree-name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {row.file.path.slice(row.file.path.lastIndexOf('/') + 1)}
        </span>
        {viewedFiles.has(row.file.id) && <Check size={13} className="review-tree-viewed" aria-label={t('Viewed')} />}
        {counts.get(row.file.id) ? <span className={DISCUSSION_COUNT_CLASS}>{counts.get(row.file.id)}</span> : null}
        {!row.file.binary && row.file.addedLines !== undefined && (
          <span className="review-tree-stat inline-flex gap-1 flex-none text-[length:11px]">
            <span className="lines-added text-ok">+{row.file.addedLines}</span>
            {!!row.file.removedLines && <span className="lines-removed text-bad">−{row.file.removedLines}</span>}
          </span>
        )}
      </Button>
    )
  return (
    <aside
      ref={treeRoot}
      data-flat={flat || undefined}
      className="review-tree [&_.review-tree-filter]:m-0 [&_.search-input]:w-full sticky top-[calc(var(--review-toolbar-height,_44px)_+_12px)] flex flex-col gap-1.5 max-h-[calc(100vh_-_200px)] min-w-0"
      aria-label={t('Changed files')}
    >
      <SearchInput
        className="review-tree-filter"
        aria-label={t('Filter files')}
        placeholder={t('Filter files…')}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onClear={() => setFilter('')}
      />
      <VirtualList
        items={rows}
        rowHeight={Math.max(27, preferences.fontSize + 12)}
        itemKey={(row) => row.key}
        renderItem={render}
        overlay
        className="review-tree-list min-h-0 flex-1 [overflow-anchor:none]"
        resetKey={`${needle}:${flat}`}
        revealKey={activeId ? `file:${activeId}` : undefined}
      />
    </aside>
  )
}
