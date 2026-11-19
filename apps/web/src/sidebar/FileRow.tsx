import { FileIcon } from '../editor/FileIcon'

/** Row box shared by the Explorer tree and Source Control changes so files look the same in both. */
export const FILE_ROW = 'flex items-center h-7 min-h-7 rounded-(--radius-s) gap-1.5 whitespace-nowrap text-soft'

/** Caret gutter, file icon and name for a file row; `dir` is the muted parent folder shown after the name. */
export function FileRowLabel({
  path,
  name,
  dir,
  gutter = true,
}: {
  path: string
  name: string
  dir?: string
  gutter?: boolean
}) {
  return (
    <>
      {gutter && <span className="w-3 flex-none" aria-hidden="true" />}
      <FileIcon path={path} className="flex-none file" />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
      {dir && (
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-caption text-muted-foreground"
          title={dir}
        >
          {dir}
        </span>
      )}
    </>
  )
}
