import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { ChangeFile } from '@ramu/shared/types'
import { proseDiff, proseSections, type ProseBlock, type WordPart } from '@ramu/shared/review/proseDiff'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { Markdown } from './Markdown'
import { T, tap } from './ui'

const HEADING = [0, 22, 19, 17, 16, 15, 15]

/** A reworded heading, paragraph or list item: its words in place, the ones that went struck in red, new ones in green. */
function Words({ block, words }: { block: ProseBlock; words: WordPart[] }) {
  const { c } = useTheme()
  const size = block.kind === 'heading' ? HEADING[block.level ?? 1]! : font.body
  return (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      {block.kind === 'item' ? <T tone="muted">{block.marker}</T> : null}
      <Text
        style={{
          flex: 1,
          color: block.kind === 'heading' ? c.text : c.body,
          fontSize: size,
          lineHeight: size + 7,
          fontWeight: block.kind === 'heading' ? '600' : undefined,
        }}
      >
        {words.map((part, index) =>
          part.kind === 'same' ? (
            part.text
          ) : (
            <Text
              key={index}
              style={
                part.kind === 'del'
                  ? { color: c.bad, backgroundColor: c.badWash, textDecorationLine: 'line-through' }
                  : { color: c.ok, backgroundColor: c.okWash }
              }
            >
              {part.text}
            </Text>
          ),
        )}
      </Text>
    </View>
  )
}

/**
 * A changed Markdown document drawn as a document, as GitHub's prose diff shows one: unchanged sections read plainly
 * (long runs fold behind a tap), removed ones sit on a red bar and read dimmed, added ones on a green bar, and a
 * reworded paragraph marks the words that changed.
 */
export function ReviewMarkdownDiff({ file }: { computerId: string; reviewId: string; file: ChangeFile }) {
  const say = useSay()
  const { c } = useTheme()
  const sections = useMemo(
    () => proseSections(proseDiff(file.status === 'added' ? '' : file.oldContent, file.newContent)),
    [file.status, file.oldContent, file.newContent],
  )
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set())
  const bar = (color: string, wash: string) => ({
    borderLeftWidth: 3,
    borderLeftColor: color,
    backgroundColor: wash,
    borderRadius: radius.xs,
    paddingVertical: space.xs,
    paddingLeft: space.m,
    paddingRight: space.s,
  })
  if (!sections.length)
    return (
      <T size={font.control} tone="muted" style={{ padding: space.m }}>
        {say('This file is empty.')}
      </T>
    )
  return (
    <View style={{ padding: space.m, gap: space.s }}>
      {sections.map((section, index) => {
        if (section.kind === 'fold')
          return shown.has(index) ? (
            <View key={index} style={{ gap: space.s }}>
              {section.entries.map((entry, at) => (
                <Markdown key={at} text={'block' in entry ? entry.block.source : ''} />
              ))}
            </View>
          ) : (
            <Pressable
              key={index}
              accessibilityRole="button"
              onPress={() => {
                tap()
                setShown((value) => new Set(value).add(index))
              }}
              style={({ pressed }) => ({
                minHeight: 36,
                justifyContent: 'center',
                paddingHorizontal: space.m,
                borderRadius: radius.s,
                backgroundColor: pressed ? c.pressed : c.fill,
              })}
            >
              <T size={font.caption} tone="muted">
                {say('Show {count} unchanged sections', { count: section.entries.length })}
              </T>
            </Pressable>
          )
        if (section.kind === 'same') return <Markdown key={index} text={section.block.source} />
        if (section.kind === 'changed')
          return (
            <View key={index} style={bar(c.warn, c.fill)}>
              <Words block={section.after} words={section.words} />
            </View>
          )
        return (
          <View
            key={index}
            accessibilityLabel={section.kind === 'del' ? say('Removed') : say('Added')}
            style={section.kind === 'del' ? bar(c.bad, c.badWash) : bar(c.ok, c.okWash)}
          >
            <Markdown text={section.block.source} muted={section.kind === 'del'} />
          </View>
        )
      })}
    </View>
  )
}
