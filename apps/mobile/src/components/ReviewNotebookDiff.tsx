import { Fragment, useMemo, useState } from 'react'
import { Image, Pressable, View } from 'react-native'
import type { ChangeFile } from '@ramu/shared/types'
import type { DiffRow } from '@ramu/shared/review/lineDiff'
import { diffNotebook, type NotebookCell, type NotebookCellChange } from '@ramu/shared/review/notebookDiff'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { ImagePreview } from './ImagePreview'
import { Markdown } from './Markdown'
import { T, tap } from './ui'

const LABEL = { added: 'Added', removed: 'Removed', modified: 'Modified', same: 'Unchanged' } as const

function Outputs({ cell }: { cell: NotebookCell }) {
  const say = useSay()
  const { c } = useTheme()
  if (!cell.outputs.length) return null
  return (
    <View style={{ gap: space.s, padding: space.s, borderTopWidth: 0.5, borderTopColor: c.line }}>
      {cell.outputs.map((output, index) =>
        output.kind === 'image' ? (
          <ImagePreview key={index} uri={output.uri} alt={say('Cell output')}>
            <Image
              source={{ uri: output.uri }}
              resizeMode="contain"
              style={{ width: '100%', height: 200, borderRadius: radius.s }}
            />
          </ImagePreview>
        ) : output.kind === 'markdown' ? (
          <Markdown key={index} text={output.text} density="compact" />
        ) : (
          <T key={index} size={font.caption} mono tone={output.error ? 'bad' : 'soft'} numberOfLines={40}>
            {output.text}
          </T>
        ),
      )}
    </View>
  )
}

function Source({ cell }: { cell: NotebookCell }) {
  return cell.type === 'markdown' ? (
    <View style={{ padding: space.s }}>
      <Markdown text={cell.source} density="compact" />
    </View>
  ) : (
    <T size={font.caption} mono tone="soft" style={{ padding: space.s }}>
      {cell.source}
    </T>
  )
}

function SourceDiff({ rows }: { rows: DiffRow[] }) {
  const { c } = useTheme()
  return (
    <View style={{ paddingVertical: space.xs }}>
      {rows.map((row, index) => (
        <T
          key={index}
          size={font.caption}
          mono
          tone={row.type === 'add' ? 'ok' : row.type === 'del' ? 'bad' : 'soft'}
          style={{
            paddingHorizontal: space.s,
            backgroundColor: row.type === 'add' ? c.okWash : row.type === 'del' ? c.badWash : undefined,
          }}
        >
          {row.type === 'add' ? '+ ' : row.type === 'del' ? '− ' : '  '}
          {row.text}
        </T>
      ))}
    </View>
  )
}

function Cell({ change }: { change: NotebookCellChange }) {
  const say = useSay()
  const { c } = useTheme()
  const cell = change.kind === 'modified' ? change.after : change.cell
  const border = { added: c.ok, removed: c.bad, modified: c.warn, same: c.line }[change.kind]
  return (
    <View style={{ borderRadius: radius.s, borderWidth: 1, borderColor: border, overflow: 'hidden' }}>
      <View
        style={{
          flexDirection: 'row',
          gap: space.s,
          paddingHorizontal: space.s,
          paddingVertical: 4,
          backgroundColor: c.fill,
        }}
      >
        <T size={font.caption} tone="muted">
          {cell.type === 'markdown' ? say('Markdown cell') : cell.type === 'raw' ? say('Raw cell') : say('Code cell')}
        </T>
        {change.kind !== 'same' ? (
          <T size={font.caption} tone={change.kind === 'added' ? 'ok' : change.kind === 'removed' ? 'bad' : 'warn'}>
            {say(LABEL[change.kind])}
          </T>
        ) : null}
      </View>
      {change.kind === 'modified' ? (
        <>
          {change.source.some((row) => row.type !== 'ctx') ? (
            <SourceDiff rows={change.source} />
          ) : (
            <Source cell={cell} />
          )}
          {change.outputsChanged ? (
            <>
              <T
                size={font.caption}
                weight="600"
                tone="bad"
                style={{ paddingHorizontal: space.s, paddingTop: space.s }}
              >
                {say('Before')}
              </T>
              <Outputs cell={change.before} />
              <T size={font.caption} weight="600" tone="ok" style={{ paddingHorizontal: space.s, paddingTop: space.s }}>
                {say('After')}
              </T>
              <Outputs cell={change.after} />
            </>
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
    </View>
  )
}

/** Unchanged cells between changes fold to one row that opens them, so the changed cells read together. */
function Unchanged({ changes }: { changes: NotebookCellChange[] }) {
  const say = useSay()
  const [open, setOpen] = useState(false)
  if (open) return changes.map((change, index) => <Cell key={index} change={change} />)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        tap()
        setOpen(true)
      }}
      style={{ minHeight: 32, justifyContent: 'center' }}
    >
      <T size={font.control} tone="accent">
        {changes.length === 1 ? say('Show 1 unchanged cell') : say('Show {0} unchanged cells', { '0': changes.length })}
      </T>
    </Pressable>
  )
}

/** A Jupyter notebook as GitHub's notebook diff shows one: cell by cell, with sources and outputs drawn. */
export function ReviewNotebookDiff({ file }: { computerId: string; reviewId: string; file: ChangeFile }) {
  const say = useSay()
  const changes = useMemo(() => diffNotebook(file.oldContent, file.newContent), [file.oldContent, file.newContent])
  if (!changes)
    return (
      <T size={font.control} tone="muted" style={{ padding: space.m }}>
        {say('This notebook could not be read. Switch to Source to see its text.')}
      </T>
    )
  const groups: NotebookCellChange[][] = []
  for (const change of changes) {
    const last = groups.at(-1)
    if (last && (last[0]!.kind === 'same') === (change.kind === 'same')) last.push(change)
    else groups.push([change])
  }
  return (
    <View style={{ padding: space.m, gap: space.s }}>
      {groups.map((group, index) => (
        <Fragment key={index}>
          {group[0]!.kind === 'same' ? (
            <Unchanged changes={group} />
          ) : (
            group.map((change, at) => <Cell key={at} change={change} />)
          )}
        </Fragment>
      ))}
    </View>
  )
}
