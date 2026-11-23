import { Fragment, useMemo, useState } from 'react'
import type { ChangeFile } from '@ramu/shared/types'
import type { DiffRow } from '@ramu/shared/review/lineDiff'
import { diffNotebook, type NotebookCell, type NotebookCellChange } from '@ramu/shared/review/notebookDiff'
import { Button } from '@/components/desktop-button'
import { MarkdownText } from '../chat/MarkdownText'
import { t, useLanguage } from '../i18n'

const TONE = {
  added: 'border-ok/50 bg-ok/5',
  removed: 'border-bad/50 bg-bad/5',
  modified: 'border-warn/50',
  same: 'border-line',
} as const

function Outputs({ cell }: { cell: NotebookCell }) {
  if (!cell.outputs.length) return null
  return (
    <div className="flex flex-col gap-2 border-t border-line p-3">
      {cell.outputs.map((output, index) =>
        output.kind === 'image' ? (
          <img
            key={index}
            src={output.uri}
            alt={t('Cell output')}
            className="block max-h-80 max-w-full object-contain"
          />
        ) : output.kind === 'markdown' ? (
          <MarkdownText key={index} density="compact">
            {output.text}
          </MarkdownText>
        ) : (
          <pre
            key={index}
            className={`m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-caption ${output.error ? 'text-bad' : 'text-soft'}`}
          >
            {output.text}
          </pre>
        ),
      )}
    </div>
  )
}

function Source({ cell }: { cell: NotebookCell }) {
  if (cell.type === 'markdown')
    return (
      <MarkdownText density="compact" className="p-3">
        {cell.source}
      </MarkdownText>
    )
  return (
    <pre className="m-0 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-caption text-soft">
      {cell.source}
    </pre>
  )
}

function SourceDiff({ rows }: { rows: DiffRow[] }) {
  return (
    <pre className="m-0 overflow-auto py-2 font-mono text-caption">
      {rows.map((row, index) => (
        <div
          key={index}
          className={`whitespace-pre-wrap break-words px-3 ${row.type === 'add' ? 'bg-ok/10 text-ok' : row.type === 'del' ? 'bg-bad/10 text-bad' : 'text-soft'}`}
        >
          {row.type === 'add' ? '+ ' : row.type === 'del' ? '− ' : '  '}
          {row.text}
        </div>
      ))}
    </pre>
  )
}

const LABEL = { added: 'Added', removed: 'Removed', modified: 'Modified', same: 'Unchanged' } as const

function Cell({ change }: { change: NotebookCellChange }) {
  const cell = change.kind === 'modified' ? change.after : change.cell
  return (
    <section className={`overflow-hidden rounded-(--radius-s) border ${TONE[change.kind]}`}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-caption text-muted-foreground">
        <span>
          {cell.type === 'markdown' ? t('Markdown cell') : cell.type === 'raw' ? t('Raw cell') : t('Code cell')}
        </span>
        {change.kind !== 'same' && (
          <span className={change.kind === 'added' ? 'text-ok' : change.kind === 'removed' ? 'text-bad' : 'text-warn'}>
            {t(LABEL[change.kind])}
          </span>
        )}
      </header>
      {change.kind === 'modified' ? (
        <>
          {change.source.some((row) => row.type !== 'ctx') ? (
            <SourceDiff rows={change.source} />
          ) : (
            <Source cell={cell} />
          )}
          {change.outputsChanged ? (
            <div className="grid grid-cols-2 gap-px bg-line">
              <div className="bg-canvas">
                <p className="m-0 px-3 pt-2 text-caption font-medium text-bad">{t('Before')}</p>
                <Outputs cell={change.before} />
              </div>
              <div className="bg-canvas">
                <p className="m-0 px-3 pt-2 text-caption font-medium text-ok">{t('After')}</p>
                <Outputs cell={change.after} />
              </div>
            </div>
          ) : (
            <Outputs cell={cell} />
          )}
        </>
      ) : (
        <>
          <Source cell={cell} />
          <Outputs cell={cell} />
        </>
      )}
    </section>
  )
}

/** Unchanged cells between changes fold to one row that opens them, so the changed cells read together. */
function Unchanged({ changes }: { changes: NotebookCellChange[] }) {
  const [open, setOpen] = useState(false)
  if (open) return changes.map((change, index) => <Cell key={index} change={change} />)
  return (
    <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setOpen(true)}>
      {changes.length === 1 ? t('Show 1 unchanged cell') : t('Show {0} unchanged cells', { '0': changes.length })}
    </Button>
  )
}

/** A Jupyter notebook as GitHub's notebook diff shows one: cell by cell, with sources and outputs drawn. */
export function ReviewNotebookDiff({ file }: { reviewId: string; file: ChangeFile }) {
  useLanguage()
  const changes = useMemo(() => diffNotebook(file.oldContent, file.newContent), [file.oldContent, file.newContent])
  if (!changes)
    return (
      <p className="m-0 p-3 text-control text-muted-foreground">
        {t('This notebook could not be read. Switch to Source to see its text.')}
      </p>
    )
  const groups: NotebookCellChange[][] = []
  for (const change of changes) {
    const last = groups.at(-1)
    if (last && (last[0]!.kind === 'same') === (change.kind === 'same')) last.push(change)
    else groups.push([change])
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      {groups.map((group, index) => (
        <Fragment key={index}>
          {group[0]!.kind === 'same' ? (
            <Unchanged changes={group} />
          ) : (
            group.map((change, at) => <Cell key={at} change={change} />)
          )}
        </Fragment>
      ))}
    </div>
  )
}
