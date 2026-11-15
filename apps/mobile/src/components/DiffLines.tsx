import { Fragment, useMemo, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { CodeTokens, grammarFor, highlightLines } from './Code'
import { space, useTheme } from '../theme'
import type { ChangedFile, DiffLine } from '../runtime/types'
import { T } from './ui'
import { useSay } from '../i18n'

/**
 * The lines of one file's diff, shared by the review screen, the file viewer and a pull request's Files changed. Scrolls
 * sideways for long lines unless `wrap` is on.
 */
export function DiffLines({
  file,
  onLine,
  onLongLine,
  marked,
  selected,
  after,
  wrap,
  lineLabel,
}: {
  file: Pick<ChangedFile, 'path' | 'lines'>
  /** Tapping a line (to comment on it). */
  onLine?: (line: DiffLine) => void
  /** Long-pressing a line (to start a block of lines). */
  onLongLine?: (line: DiffLine) => void
  /** `old:12` / `new:7` keys of lines that already have a comment. */
  marked?: Set<string>
  /** A new-side line picked as the start of a block of lines. */
  selected?: number | null
  /** What sits under a line: its review threads and pending comments. */
  after?: (line: DiffLine) => ReactNode
  wrap?: boolean
  /** What a tappable line says to a screen reader. */
  lineLabel?: (line: DiffLine) => string
}) {
  const say = useSay()
  const { c } = useTheme()
  // Each side is highlighted as a whole (so multi-line strings and comments colour correctly), then matched back by line number.
  const colors = useMemo(() => {
    const grammar = grammarFor('', file.path)
    const side = (type: 'del' | 'add') =>
      file.lines
        .filter((l) => l.type === type || l.type === 'ctx')
        .map((l) => ({ number: type === 'del' ? l.old : l.new, text: l.text }))
    const build = (type: 'del' | 'add') => {
      const rows = side(type)
      const lines = highlightLines(rows.map((r) => r.text).join('\n'), grammar)
      return new Map(rows.map((r, i) => [r.number, lines?.[i]]))
    }
    return { old: build('del'), new: build('add') }
  }, [file])
  const body = (
    <View style={{ paddingVertical: space.s, minWidth: '100%', width: wrap ? '100%' : undefined }}>
      {file.lines.map((l, i) => {
        const bg =
          l.type === 'add' ? c.okWash : l.type === 'del' ? c.badWash : l.type === 'hunk' ? c.accentWash : 'transparent'
        const sign = l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '
        const picked = selected != null && l.type !== 'del' && l.new === selected
        return (
          <Fragment key={i}>
            <Pressable
              disabled={(!onLine && !onLongLine) || l.type === 'hunk'}
              accessibilityRole={onLine && l.type !== 'hunk' ? 'button' : undefined}
              accessibilityLabel={lineLabel?.(l) ?? say('Comment on line {0}', { 0: l.new ?? l.old ?? '' })}
              delayLongPress={350}
              onPress={() => onLine?.(l)}
              onLongPress={onLongLine ? () => onLongLine(l) : undefined}
              style={({ pressed }) => ({
                flexDirection: 'row',
                backgroundColor: picked
                  ? c.accentSoft
                  : marked?.has(l.type === 'del' ? `old:${l.old}` : `new:${l.new}`)
                    ? c.warnWash
                    : bg,
                paddingRight: space.l,
                opacity: pressed && (onLine || onLongLine) ? 0.6 : 1,
              })}
            >
              <T size={11} mono tone="placeholder" style={{ width: 30, textAlign: 'right', paddingVertical: 1 }}>
                {l.type === 'hunk' ? '' : (l.new ?? l.old ?? '')}
              </T>
              <T
                size={12}
                mono
                tone={l.type === 'add' ? 'ok' : l.type === 'del' ? 'bad' : 'muted'}
                style={{ width: 18, textAlign: 'center', paddingVertical: 1 }}
              >
                {l.type === 'hunk' ? '' : sign}
              </T>
              <T
                size={12}
                mono
                tone={l.type === 'hunk' ? 'accent' : 'soft'}
                style={{ paddingVertical: 1, flexShrink: wrap ? 1 : 0 }}
              >
                {!l.text
                  ? ' '
                  : l.type === 'hunk'
                    ? l.skipped
                      ? say('… {0} unchanged lines …', { 0: l.skipped })
                      : l.text
                    : (() => {
                        const tokens = l.type === 'del' ? colors.old.get(l.old) : colors.new.get(l.new)
                        return tokens ? <CodeTokens tokens={tokens} /> : l.text
                      })()}
              </T>
            </Pressable>
            {after?.(l)}
          </Fragment>
        )
      })}
    </View>
  )
  if (wrap) return <View style={{ backgroundColor: c.code, borderRadius: 10 }}>{body}</View>
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: c.code, borderRadius: 10 }}>
      {body}
    </ScrollView>
  )
}
