import type { CSSProperties, DragEvent, MouseEvent, KeyboardEvent, Ref } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { visibleName } from '@ramu/shared/text'
import type { DirEntry } from '@ramu/shared/types'
import { FILE_ROW, FileRowLabel } from '../FileRow'
import { TreeCaret } from './TreeCaret'

export type TreeRowHandlers = {
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, entry: DirEntry) => void
  onContextKey: (event: KeyboardEvent<HTMLButtonElement>, entry: DirEntry) => void
  onDragOver: (event: DragEvent, entry: DirEntry) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent, entry: DirEntry) => void
  onDragEnd: () => void
  onDragStart: (event: DragEvent, entry: DirEntry) => void
  onOpenPinned: (entry: DirEntry) => void
  onClick: (event: MouseEvent<HTMLButtonElement>, entry: DirEntry) => void
}

/** One file or folder line of a repository tree. */
export function TreeRow({
  entry: e,
  depth,
  repoId,
  isOpen,
  isSelected,
  isPicked,
  isDropTarget,
  rowRef,
  handlers,
}: {
  entry: DirEntry
  depth: number
  repoId: string
  isOpen: boolean
  isSelected: boolean
  isPicked: boolean
  isDropTarget: boolean
  rowRef?: Ref<HTMLButtonElement>
  handlers: TreeRowHandlers
}) {
  return (
    <Button
      variant="tree"
      ref={rowRef}
      data-path={`${repoId}:${e.path}`}
      className={`tree-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&.selected]:bg-accent [&.selected]:text-foreground [&.selected]:[box-shadow:none] [&.selected:hover]:bg-accent [&.selected:hover]:text-foreground [&.selected:hover]:[box-shadow:none] [&:focus-visible]:[outline-color:var(--line-strong)] [&[draggable='true']]:[-webkit-user-drag:element] [&.picked]:bg-accent [&.picked]:text-foreground [&.drop-target]:bg-brand-wash [&.drop-target]:[box-shadow:none] ${FILE_ROW} w-full bg-transparent [border:none] p-[3px_4px] text-left justify-start${e.kind === 'dir' && isOpen ? ' tree-folder-sticky' : ''}${isSelected ? ' selected' : ''}${isPicked ? ' picked' : ''}${isDropTarget ? ' drop-target' : ''}`}
      aria-expanded={e.kind === 'dir' ? isOpen : undefined}
      aria-current={isSelected ? 'page' : undefined}
      onContextMenu={(event) => handlers.onContextMenu(event, e)}
      onKeyDown={(event) => handlers.onContextKey(event, e)}
      onDragOver={(event) => handlers.onDragOver(event, e)}
      onDragLeave={handlers.onDragLeave}
      onDrop={(event) => handlers.onDrop(event, e)}
      onDragEnd={handlers.onDragEnd}
      title={e.path}
      draggable
      onDragStart={(event) => handlers.onDragStart(event, e)}
      style={
        {
          paddingLeft: 8 + depth * 12,
          '--tree-sticky-top': `calc(${depth} * var(--tree-row-height))`,
          '--tree-sticky-layer': Math.max(2, 40 - depth),
          scrollMarginTop: `calc(${depth + 1} * var(--tree-row-height))`,
        } as CSSProperties
      }
      onDoubleClick={() => handlers.onOpenPinned(e)}
      onClick={(event) => handlers.onClick(event, e)}
    >
      <span className="tree-row-guides" aria-hidden="true">
        {Array.from({ length: depth }, (_, index) => (
          <span key={index} className="tree-row-guide" style={{ left: 14 + index * 12 }} />
        ))}
      </span>
      {e.kind === 'dir' ? (
        <>
          <TreeCaret open={isOpen} />
          {isOpen ? (
            <FolderOpen
              size={14}
              className="tree-icon [.commit-file-A_&]:text-ok [.commit-file-D_&]:text-bad flex-none text-muted-foreground"
            />
          ) : (
            <Folder
              size={14}
              className="tree-icon [.commit-file-A_&]:text-ok [.commit-file-D_&]:text-bad flex-none text-muted-foreground"
            />
          )}
          <span className="tree-name relative top-[-1px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {visibleName(e.name)}
          </span>
        </>
      ) : (
        <FileRowLabel path={e.path} name={visibleName(e.name)} />
      )}
    </Button>
  )
}
