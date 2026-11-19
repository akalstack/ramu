import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { ChangeFile } from '@ramu/shared/types'
import { foldTableRows, MAX_TABLE_ROWS, tableDiff, type TableDiffRow } from '@ramu/shared/review/tableDiff'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { T, tap } from './ui'

/** A column as wide as its longest cell needs, within what a phone row can carry. */
function columnWidth(name: string, rows: TableDiffRow[], index: number): number {
  const longest = rows.reduce((max, row) => {
    const cell = row.cells[index]
    return Math.max(max, (cell?.before ?? '').length, (cell?.after ?? '').length)
  }, name.length)
  return Math.min(220, Math.max(72, longest * 7.5 + space.m * 2))
}

/**
 * A changed CSV or TSV for a phone: the table scrolls sideways under its header, added rows green, removed rows red and
 * struck, edited cells showing old over new, and long unchanged stretches folded until tapped.
 */
export function ReviewTableDiff({ file }: { computerId: string; reviewId: string; file: ChangeFile }) {
  const say = useSay()
  const { c } = useTheme()
  const delimiter = /\.tsv$/i.test(file.path) ? '\t' : ','
  const diff = useMemo(() => {
    try {
      return tableDiff(file.oldContent, file.newContent, delimiter)
    } catch {
      return null
    }
  }, [file.oldContent, file.newContent, delimiter])
  const segments = useMemo(() => (diff ? foldTableRows(diff.rows) : []), [diff])
  const widths = useMemo(
    () => diff?.columns.map((column, index) => columnWidth(column.name, diff.rows, index)) ?? [],
    [diff],
  )
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set())
  if (!diff || !diff.columns.length)
    return (
      <T size={font.control} tone="muted" style={{ padding: space.m }}>
        {diff ? say('This table is empty.') : say('This table could not be read; see its source.')}
      </T>
    )
  const total = widths.reduce((sum, width) => sum + width, 0)
  const columnWash = (status: string) =>
    status === 'added' ? c.okWash : status === 'removed' ? c.badWash : 'transparent'
  const rowWash = (row: TableDiffRow) =>
    row.kind === 'added' ? c.okWash : row.kind === 'removed' ? c.badWash : 'transparent'
  const cellStyle = (index: number) => ({
    width: widths[index],
    paddingHorizontal: space.s,
    paddingVertical: 6,
  })
  const line = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }
  return (
    <View style={{ padding: space.m, gap: space.s }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ borderRadius: radius.s, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }}
      >
        <View style={{ width: total }}>
          <View style={{ flexDirection: 'row', backgroundColor: c.fill }}>
            {diff.columns.map((column, index) => (
              <View key={index} style={[cellStyle(index), { backgroundColor: columnWash(column.status) }]}>
                <T
                  size={font.caption}
                  weight="600"
                  tone={column.status === 'added' ? 'ok' : column.status === 'removed' ? 'bad' : 'text'}
                  numberOfLines={1}
                  style={column.status === 'removed' ? { textDecorationLine: 'line-through' } : undefined}
                >
                  {column.name}
                </T>
              </View>
            ))}
          </View>
          {segments.map((segment, index) =>
            segment.kind === 'fold' && !opened.has(index) ? (
              <Pressable
                key={index}
                accessibilityRole="button"
                onPress={() => {
                  tap()
                  setOpened((value) => new Set(value).add(index))
                }}
                style={({ pressed }) => [
                  line,
                  { paddingHorizontal: space.s, paddingVertical: 8, backgroundColor: pressed ? c.pressed : c.code },
                ]}
              >
                <T size={font.caption} tone="muted">
                  {segment.rows.length === 1
                    ? say('Show 1 unchanged row')
                    : say('Show {0} unchanged rows', { '0': segment.rows.length })}
                </T>
              </Pressable>
            ) : (
              segment.rows.map((row, at) => (
                <View key={`${index}-${at}`} style={[line, { flexDirection: 'row', backgroundColor: rowWash(row) }]}>
                  {row.cells.map((cell, column) => {
                    const wash =
                      row.kind === 'same' || row.kind === 'changed'
                        ? columnWash(diff.columns[column]!.status)
                        : 'transparent'
                    const edited = row.kind === 'changed' && cell.before !== cell.after
                    return (
                      <View key={column} style={[cellStyle(column), { backgroundColor: wash }]}>
                        {edited ? (
                          <>
                            {cell.before !== undefined ? (
                              <T size={font.caption} tone="bad" style={{ textDecorationLine: 'line-through' }}>
                                {cell.before}
                              </T>
                            ) : null}
                            {cell.after !== undefined ? (
                              <T size={font.caption} tone="ok">
                                {cell.after}
                              </T>
                            ) : null}
                          </>
                        ) : (
                          <T
                            size={font.caption}
                            tone={row.kind === 'removed' ? 'muted' : 'text'}
                            style={row.kind === 'removed' ? { textDecorationLine: 'line-through' } : undefined}
                          >
                            {cell.after ?? cell.before}
                          </T>
                        )}
                      </View>
                    )
                  })}
                </View>
              ))
            ),
          )}
        </View>
      </ScrollView>
      {diff.truncated ? (
        <T size={font.caption} tone="muted">
          {say('Only the first {0} rows are compared; see the source for the rest.', { '0': MAX_TABLE_ROWS })}
        </T>
      ) : null}
    </View>
  )
}
