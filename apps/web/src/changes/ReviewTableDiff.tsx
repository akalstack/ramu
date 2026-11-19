import { useMemo, useState } from 'react'
import type { ChangeFile } from '@ramu/shared/types'
import { foldTableRows, MAX_TABLE_ROWS, tableDiff, type TableDiffRow } from '@ramu/shared/review/tableDiff'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'

const ROW_TINT: Record<TableDiffRow['kind'], string> = {
  same: '',
  added: 'bg-ok/10',
  removed: 'bg-bad/10 text-muted-foreground line-through',
  changed: '',
}

function Cell({ row, cell }: { row: TableDiffRow; cell: TableDiffRow['cells'][number] }) {
  // A changed row shows what each edited cell was, struck, beside what it became.
  if (row.kind === 'changed' && cell.before !== cell.after)
    return (
      <span className="inline-flex flex-wrap gap-x-1.5">
        {cell.before !== undefined && <del className="rounded-xs bg-bad/15 px-0.5 text-bad">{cell.before}</del>}
        {cell.after !== undefined && (
          <ins className="rounded-xs bg-ok/15 px-0.5 text-ok no-underline">{cell.after}</ins>
        )}
      </span>
    )
  return <>{cell.after ?? cell.before}</>
}

/**
 * A changed CSV or TSV as GitHub draws one: a table under its header, added rows green, removed rows red and struck,
 * edited cells showing old and new, and long unchanged stretches folded away until asked for.
 */
export function ReviewTableDiff({ file }: { reviewId: string; file: ChangeFile }) {
  useLanguage()
  const delimiter = /\.tsv$/i.test(file.path) ? '\t' : ','
  const diff = useMemo(() => {
    try {
      return tableDiff(file.oldContent, file.newContent, delimiter)
    } catch {
      return null
    }
  }, [file.oldContent, file.newContent, delimiter])
  const segments = useMemo(() => (diff ? foldTableRows(diff.rows) : []), [diff])
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set())
  if (!diff)
    return (
      <p className="m-0 p-3 text-control text-muted-foreground">{t('This table could not be read; see its source.')}</p>
    )
  if (!diff.columns.length)
    return <p className="m-0 p-3 text-control text-muted-foreground">{t('This table is empty.')}</p>
  const columnTint = (status: string) => (status === 'added' ? 'bg-ok/10' : status === 'removed' ? 'bg-bad/10' : '')
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="max-w-full overflow-x-auto rounded-lg border border-line bg-card/50">
        <Table className="w-auto border-collapse border-spacing-0 text-control">
          <TableHeader className="bg-fill">
            <TableRow className="border-line">
              {diff.columns.map((column, index) => (
                <TableHead
                  key={index}
                  className={`h-9 px-3 text-control font-semibold whitespace-nowrap ${columnTint(column.status)} ${column.status === 'added' ? 'text-ok' : column.status === 'removed' ? 'text-bad line-through' : ''}`}
                >
                  {column.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {segments.map((segment, index) =>
              segment.kind === 'fold' && !opened.has(index) ? (
                <TableRow key={index} className="border-line">
                  <TableCell colSpan={diff.columns.length} className="p-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start rounded-none text-caption text-muted-foreground"
                      onClick={() => setOpened((value) => new Set(value).add(index))}
                    >
                      {segment.rows.length === 1
                        ? t('Show 1 unchanged row')
                        : t('Show {0} unchanged rows', { '0': segment.rows.length })}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                segment.rows.map((row, at) => (
                  <TableRow key={`${index}-${at}`} className={`border-line ${ROW_TINT[row.kind]}`}>
                    {row.cells.map((cell, column) => (
                      <TableCell
                        key={column}
                        className={`px-3 py-1.5 align-top whitespace-pre-wrap ${row.kind === 'same' || row.kind === 'changed' ? columnTint(diff.columns[column]!.status) : ''}`}
                      >
                        <Cell row={row} cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ),
            )}
          </TableBody>
        </Table>
      </div>
      {diff.truncated && (
        <p className="m-0 text-caption text-muted-foreground">
          {t('Only the first {0} rows are compared; see the source for the rest.', { '0': MAX_TABLE_ROWS })}
        </p>
      )}
    </div>
  )
}
