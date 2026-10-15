import { useMemo } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { CodeTokens, grammarFor, highlightLines } from './Code'
import { space, useTheme } from '../theme'
import type { ChangedFile } from '../runtime/types'
import { T } from './ui'

/** The lines of one file's diff, shared by the review screen and the file viewer. Scrolls sideways for long lines. */
export function DiffLines({
  file,
  onLine,
  marked,
}: {
  file: ChangedFile
  /** Tapping a line (to comment on it). */ onLine?: (line: import('../runtime/types').DiffLine) => void
  /** `old:12` / `new:7` keys of lines that already have a comment. */ marked?: Set<string>
}) {
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
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: c.code, borderRadius: 10 }}>
      <View style={{ paddingVertical: space.s, minWidth: '100%' }}>
        {file.lines.map((l, i) => {
          const bg =
            l.type === 'add'
              ? c.okWash
              : l.type === 'del'
                ? c.badWash
                : l.type === 'hunk'
                  ? c.accentWash
                  : 'transparent'
          const sign = l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '
          return (
            <Pressable
              key={i}
              disabled={!onLine || l.type === 'hunk'}
              accessibilityLabel={`Comment on line ${l.new ?? l.old}`}
              onPress={() => onLine?.(l)}
              style={{
                flexDirection: 'row',
                backgroundColor: marked?.has(l.type === 'del' ? `old:${l.old}` : `new:${l.new}`) ? c.warnWash : bg,
                paddingRight: space.l,
              }}
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
              <T size={12} mono tone={l.type === 'hunk' ? 'accent' : 'soft'} style={{ paddingVertical: 1 }}>
                {!l.text
                  ? ' '
                  : l.type === 'hunk'
                    ? l.text
                    : (() => {
                        const tokens = l.type === 'del' ? colors.old.get(l.old) : colors.new.get(l.new)
                        return tokens ? <CodeTokens tokens={tokens} /> : l.text
                      })()}
              </T>
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}
