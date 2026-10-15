import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Image, Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native'
import { CodeBlock } from './Code'
import { parseBlocks, type Block } from '../runtime/markdown'
import { chatReferences } from '@ramu/shared/chatReferences'
import { localFileLink } from '@ramu/shared/fileLinks'
import { font, radius, space, useTheme } from '../theme'

// Native markdown for agent replies: headings, lists, tasks, quotes, tables, rules, coloured code, emphasis and links.
// Kept native: shared's react-markdown renderer depends on the DOM.

/** What a tapped reference does. The chat screen provides it; without one, references still render as badges. */
export interface ReferenceActions {
  openFile(href: string): void
  openUrl(url: string): void
  /** A workspace image path to something drawable (a data URL fetched from the computer). */ image?(
    href: string,
  ): Promise<string | null>
}
export const ReferenceContext = createContext<ReferenceActions>({
  openFile: () => {},
  openUrl: (url) => void Linking.openURL(url).catch(() => {}),
})

/** A badge inside running text: a tinted, tappable span (nested Text is the one inline element both platforms lay out). */
export function ReferenceBadge({
  kind,
  label,
  onPress,
}: {
  kind: 'file' | 'skill' | 'command' | 'quote'
  label: string
  onPress?: () => void
}) {
  const { c } = useTheme()
  const glyph = kind === 'skill' ? '✦ ' : kind === 'command' ? '/' : kind === 'quote' ? '❝ ' : ''
  return (
    <Text
      onPress={onPress}
      accessibilityRole={onPress ? 'link' : undefined}
      suppressHighlighting
      style={{
        backgroundColor: c.fill,
        color: kind === 'file' ? c.accent : kind === 'skill' ? c.accent : c.soft,
        fontSize: font.control + 0.5,
        fontWeight: '500',
        fontFamily: kind === 'file' || kind === 'command' ? font.mono : undefined,
      }}
    >
      {`\u00A0${glyph}${label.replace(/ /g, '\u00A0')}\u00A0`}
    </Text>
  )
}

/** Plain prose with explicit references (`@file`, `$skill`) turned into badges. */
function Prose({ text }: { text: string }) {
  const actions = useContext(ReferenceContext)
  return (
    <>
      {chatReferences(text).map((part, index) =>
        part.kind === 'text' ? (
          part.text
        ) : part.kind === 'skill' ? (
          <ReferenceBadge key={index} kind="skill" label={part.target} />
        ) : (
          <ReferenceBadge
            key={index}
            kind="file"
            label={part.target.split('/').at(-1) ?? part.target}
            onPress={() => actions.openFile(part.target)}
          />
        ),
      )}
    </>
  )
}

/** Padding that never wraps alone onto its own line; spaces inside stay breakable once the snippet is long, so it cannot run off screen. */
const NBSP = '\u00A0'
const padCode = (code: string) => `${NBSP}${code.length <= 28 ? code.replace(/ /g, NBSP) : code}${NBSP}`

// Inline marks, earliest first: code, bold, strike, links, bare URLs, then italics (which must not start inside a word).
const INLINE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\s]+\)|<https?:\/\/[^>\s]+>|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|\*[^*\s](?:[^*\n]*[^*\s])?\*|\b_[^_\s](?:[^_\n]*[^_\s])?_\b)/g

function inline(
  text: string,
  key: string,
  c: ReturnType<typeof useTheme>['c'],
  actions: ReferenceActions,
): ReactNode[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((p, i) => {
      const k = `${key}-${i}`
      if (p.startsWith('`') && p.endsWith('`') && p.length > 1)
        return (
          <Text
            key={k}
            style={{ fontFamily: font.mono, fontSize: font.control, color: c.soft, backgroundColor: c.fill }}
          >
            {padCode(p.slice(1, -1))}
          </Text>
        )
      if (((p.startsWith('**') && p.endsWith('**')) || (p.startsWith('__') && p.endsWith('__'))) && p.length > 4)
        return (
          <Text key={k} style={{ fontWeight: '600', color: c.text }}>
            {inline(p.slice(2, -2), k, c, actions)}
          </Text>
        )
      if (p.startsWith('~~') && p.endsWith('~~') && p.length > 4)
        return (
          <Text key={k} style={{ textDecorationLine: 'line-through', color: c.muted }}>
            {inline(p.slice(2, -2), k, c, actions)}
          </Text>
        )
      if (((/^\*[^*]/.test(p) && p.endsWith('*')) || (/^_[^_]/.test(p) && p.endsWith('_'))) && p.length > 2)
        return (
          <Text key={k} style={{ fontStyle: 'italic' }}>
            {inline(p.slice(1, -1), k, c, actions)}
          </Text>
        )
      const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      const url = link ? link[2]! : /^<https?:\/\//.test(p) ? p.slice(1, -1) : /^https?:\/\//.test(p) ? p : null
      if (url) {
        const label = link ? link[1]! : url
        if (localFileLink(url) && !/^https?:/i.test(url))
          return <ReferenceBadge key={k} kind="file" label={label} onPress={() => actions.openFile(url)} />
        if (/^https?:\/\//i.test(url))
          return (
            <Text
              key={k}
              onPress={() => actions.openUrl(url)}
              accessibilityRole="link"
              style={{ color: c.accent, textDecorationLine: 'underline' }}
            >
              {label}
            </Text>
          )
        return label
      }
      return <Prose key={k} text={p} />
    })
}

function Inline({ text, style }: { text: string; style?: TextStyle }) {
  const { c } = useTheme()
  const actions = useContext(ReferenceContext)
  return (
    <Text style={[{ color: c.body, fontSize: font.body, lineHeight: 22 }, style]}>{inline(text, 'i', c, actions)}</Text>
  )
}

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const { c } = useTheme()
  const actions = useContext(ReferenceContext)
  const remote = /^(https?:|data:image\/)/i.test(src)
  const [uri, setUri] = useState<string | null>(remote ? src : null)
  const [ratio, setRatio] = useState(4 / 3)
  useEffect(() => {
    if (remote) return
    let alive = true
    void actions
      .image?.(src)
      .then((value) => {
        if (alive) setUri(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [src])
  useEffect(() => {
    if (uri)
      Image.getSize(
        uri,
        (w, h) => {
          if (w && h) setRatio(w / h)
        },
        () => {},
      )
  }, [uri])
  if (!uri) return <Text style={{ color: c.muted, fontSize: font.control }}>{alt || src}</Text>
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={alt}
      resizeMode="contain"
      style={{ width: '100%', aspectRatio: ratio, maxHeight: 420, borderRadius: radius.m, backgroundColor: c.fill }}
    />
  )
}

const HEADING = [0, 22, 19, 17, 16, 15, 15]

function BlockView({ block }: { block: Block }) {
  const { c } = useTheme()
  switch (block.kind) {
    case 'code':
      return <CodeBlock source={block.source} hint={block.lang} />
    case 'heading':
      return (
        <Inline
          text={block.text}
          style={{
            fontSize: HEADING[block.level],
            lineHeight: HEADING[block.level]! + 6,
            fontWeight: '600',
            color: c.text,
            marginTop: block.level <= 2 ? space.s : 0,
          }}
        />
      )
    case 'image':
      return <MarkdownImage src={block.src} alt={block.alt} />
    case 'rule':
      return (
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.lineStrong, marginVertical: space.s }} />
      )
    case 'quote':
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: c.lineStrong, paddingLeft: space.m }}>
          <Markdown text={block.text} muted />
        </View>
      )
    case 'paragraph':
      return <Inline text={block.text} />
    case 'list': {
      let counter = 0
      return (
        <View style={{ gap: 4 }}>
          {block.items.map((item, index) => {
            counter = item.ordered
              ? index && block.items[index - 1]!.ordered && block.items[index - 1]!.depth === item.depth
                ? counter + 1
                : Number.parseInt(item.marker, 10) || 1
              : counter
            const bullet = item.task
              ? item.done
                ? '☑'
                : '☐'
              : item.ordered
                ? `${counter}.`
                : item.depth % 2
                  ? '◦'
                  : '•'
            return (
              <View key={index} style={{ flexDirection: 'row', paddingLeft: item.depth * 18 }}>
                <Text
                  style={{
                    width: item.ordered ? 26 : 18,
                    color: item.task && item.done ? c.ok : c.muted,
                    fontSize: font.body,
                    lineHeight: 22,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {bullet}
                </Text>
                <View style={{ flex: 1 }}>
                  <Inline
                    text={item.text}
                    style={item.task && item.done ? { color: c.muted, textDecorationLine: 'line-through' } : undefined}
                  />
                </View>
              </View>
            )
          })}
        </View>
      )
    }
    case 'table': {
      const strip = (text: string) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '')
      // A column is as wide as its longest line (within limits), so short tables fit and wide ones scroll instead of squeezing.
      const longest = (col: number) =>
        Math.max(
          0,
          ...[block.head, ...block.rows].flatMap((row) =>
            strip(row[col] ?? '')
              .split('\n')
              .map((line) => line.length),
          ),
        )
      const widths = block.head.map((_, col) => Math.min(260, Math.max(72, Math.round(longest(col) * 7.4) + 22)))
      return (
        <View
          style={{
            alignSelf: 'stretch',
            borderRadius: radius.s,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.lineStrong,
            overflow: 'hidden',
          }}
        >
          <ScrollView
            horizontal
            nestedScrollEnabled
            directionalLockEnabled
            showsHorizontalScrollIndicator
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <View style={{ flexGrow: 1 }}>
              {[block.head, ...block.rows].map((row, r) => (
                <View
                  key={r}
                  style={{
                    flexDirection: 'row',
                    flexGrow: 1,
                    backgroundColor: r === 0 ? c.fill : r % 2 ? 'transparent' : c.raised2,
                    borderTopWidth: r ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: c.line,
                  }}
                >
                  {block.head.map((_, col) => (
                    <View
                      key={col}
                      style={{
                        width: widths[col],
                        flexGrow: 1,
                        paddingHorizontal: space.s + 2,
                        paddingVertical: space.s,
                        borderLeftWidth: col ? StyleSheet.hairlineWidth : 0,
                        borderLeftColor: c.line,
                      }}
                    >
                      <Inline
                        text={row[col] ?? ''}
                        style={{
                          fontSize: font.control,
                          lineHeight: 19,
                          textAlign: block.align[col] ?? 'left',
                          ...(r === 0 ? { fontWeight: '600', color: c.text } : {}),
                        }}
                      />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )
    }
  }
}

/** Agent replies as the desktop renders them: GitHub Markdown with coloured code, tables, lists and badges for references. */
/**
 * The reply is still being written, so its last line may be cut mid-way: an unclosed `code`, **bold**, ~~strike~~ or [link
 * shows as formatted text instead of raw markers. An unclosed fence already runs to the end in the parser.
 */
export function closePartial(text: string): string {
  const lines = text.split('\n')
  if (lines.filter((line) => /^\s*(```|~~~)/.test(line)).length % 2) return text
  let tail = lines[lines.length - 1]!
  if ((tail.match(/`/g)?.length ?? 0) % 2) tail += '`'
  if ((tail.match(/\*\*/g)?.length ?? 0) % 2) tail += '**'
  if ((tail.match(/~~/g)?.length ?? 0) % 2) tail += '~~'
  const open = tail.lastIndexOf('[')
  if (open >= 0 && !tail.slice(open).includes(']')) tail = tail.slice(0, open) + tail.slice(open + 1)
  lines[lines.length - 1] = tail
  return lines.join('\n')
}

export function Markdown({
  text,
  muted,
  streaming,
}: {
  text: string
  muted?: boolean
  /** The reply is still arriving: complete its cut-off last line for display. */ streaming?: boolean
}) {
  const blocks = useMemo(() => parseBlocks(streaming ? closePartial(text) : text), [text, streaming])
  return (
    <View style={{ gap: space.m, opacity: muted ? 0.8 : 1 }}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </View>
  )
}
