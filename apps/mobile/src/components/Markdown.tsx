import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Image, Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native'
import { ReferenceBadge } from './ReferenceChip'
export { ReferenceBadge } from './ReferenceChip'
import { CodeBlock } from './Code'
import { Arrive } from './Motion'
import { parseBlocks, splitLongParagraph, type Block } from '../runtime/markdown'
import { chatReferences } from '@ramu/shared/chat/chatReferences'
import { draftChip, skillChip } from '@ramu/shared/chat/referenceChip'
import { inlineCodeFileLink, localFileLink } from '@ramu/shared/workspace/fileLinks'
import { TEXT_SCALE, font, radius, useTheme } from '../theme'
import type { ProseDensity } from '@ramu/shared/prose'
import { phoneProse, type PhoneProse } from '../runtime/prose'
import { ImagePreview } from './ImagePreview'
import { NativeMarkdown, TextMarkContext, nativeMarkdown } from './NativeMarkdown'
import { markSource } from '../runtime/textMark'
import { markdownBlocks, nativeMarkdownSource, splitCodeFences } from '../runtime/nativeMarkdownSource'

// Markdown on the phone. The native Markdown view (NativeMarkdown) draws it in every app build, with native selection and
// its menu; the block renderer below draws it where that view does not exist (the web build), from React Native parts,
// since shared's react-markdown renderer depends on the DOM.

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

/**
 * The reading scale of the Markdown being drawn. A nested block (a quote) keeps its message's scale; every message
 * names its own density.
 */
const ProseContext = createContext<PhoneProse | null>(null)
const DEFAULT_PROSE = phoneProse('reply', 1, font)
const useProse = () => useContext(ProseContext) ?? DEFAULT_PROSE

/** Plain prose with explicit references (`@file`, `$skill`) turned into badges. */
function prose(text: string, actions: ReferenceActions) {
  return chatReferences(text).map((part, index) =>
    part.kind === 'text' ? (
      part.text
    ) : part.kind === 'skill' ? (
      <ReferenceBadge key={index} chip={skillChip(part.target)} />
    ) : (
      <ReferenceBadge
        key={index}
        chip={draftChip({ kind: 'file', label: part.target, target: part.target })}
        onPress={() => actions.openFile(part.target)}
      />
    ),
  )
}

/** Inline code as on desktop: smaller mono text in body colour on a small rounded tint. */
function InlineCode({ code, c }: { code: string; c: ReturnType<typeof useTheme>['c'] }) {
  const prose = useProse()
  return (
    <Text
      style={{
        fontFamily: font.mono,
        fontSize: prose.code,
        color: c.text,
        backgroundColor: c.fill,
        borderRadius: radius.xs,
        paddingHorizontal: 4,
      }}
    >
      {code}
    </Text>
  )
}

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
      if (p.startsWith('`') && p.endsWith('`') && p.length > 1) {
        // Agents name files in backticks more often than as links; a path there opens like a linked file.
        const path = inlineCodeFileLink(p.slice(1, -1))
        if (path)
          return (
            <ReferenceBadge
              key={k}
              chip={draftChip({ kind: 'file', label: path, target: path })}
              onPress={() => actions.openFile(path)}
            />
          )
        return <InlineCode key={k} code={p.slice(1, -1)} c={c} />
      }
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
          return (
            <ReferenceBadge
              key={k}
              chip={{ ...draftChip({ kind: 'file', label, target: url }), label }}
              onPress={() => actions.openFile(url)}
            />
          )
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
      return prose(p, actions)
    })
}

/** A block of text with its inline marks, references and links. On the web this is the browser's selectable text. */
function Inline({ text, style }: { text: string; style?: TextStyle }) {
  const { c } = useTheme()
  const actions = useContext(ReferenceContext)
  const prose = useProse()
  return (
    // iOS dims pressable text while a finger rests on it, which flickers the reply as it scrolls; it keeps its colour.
    <Text style={[{ color: c.body, fontSize: prose.size, lineHeight: prose.lineHeight }, style]} suppressHighlighting>
      {inline(text, 'i', c, actions)}
    </Text>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [src] by design; the values it reads beyond these are current as of that run
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
    <ImagePreview uri={uri} alt={alt}>
      <Image
        source={{ uri }}
        accessibilityLabel={alt}
        resizeMode="contain"
        style={{ width: '100%', aspectRatio: ratio, maxHeight: 420, borderRadius: radius.m, backgroundColor: c.fill }}
      />
    </ImagePreview>
  )
}

function BlockView({ block }: { block: Block }) {
  const { c } = useTheme()
  const prose = useProse()
  switch (block.kind) {
    case 'code':
      return <CodeBlock source={block.source} hint={block.lang} />
    case 'heading':
      return (
        <Inline
          text={block.text}

          style={{
            ...prose.headings[block.level - 1],
            fontWeight: '600',
            color: c.text,
            marginTop: Math.max(0, prose.headingGap - prose.blockGap),
          }}
        />
      )
    case 'image':
      return <MarkdownImage src={block.src} alt={block.alt} />
    case 'rule':
      return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.lineStrong }} />
    case 'quote':
      return (
        <View style={{ borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingLeft: prose.size }}>
          <Markdown text={block.text} muted />
        </View>
      )
    case 'paragraph': {
      const pieces = splitLongParagraph(block.text)
      if (pieces.length === 1) return <Inline text={block.text} />
      return (
        <View>
          {pieces.map((piece, index) => (
            <Inline key={index} text={piece} />
          ))}
        </View>
      )
    }
    case 'list': {
      let counter = 0
      return (
        <View style={{ gap: prose.itemGap }}>
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
                    fontSize: prose.size,
                    lineHeight: prose.lineHeight,
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
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderLeftWidth: col ? StyleSheet.hairlineWidth : 0,
                        borderLeftColor: c.line,
                      }}
                    >
                      <Inline
                        text={row[col] ?? ''}
                        style={{
                          fontSize: prose.small,
                          lineHeight: prose.smallLineHeight,
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

/**
 * A reply in the native text view, with its closed code fences drawn as code blocks and its images as tappable images
 * between the text, so a long code line scrolls sideways and an image opens larger. Highlights from a find mark each text part.
 */
function NativeParts({
  source,
  marks,
  streaming,
  muted,
  actions,
}: {
  source: string
  marks?: readonly string[] | null
  streaming?: boolean
  muted?: boolean
  actions: ReferenceActions
}) {
  const prose = useProse()
  const parts = useMemo(() => splitCodeFences(source), [source])
  const single = parts.length === 1 && parts[0]!.kind === 'text'
  const draw = (text: string, key?: number) => {
    const marked = marks?.length ? markSource(text, marks) : null
    return (
      <NativeMarkdown
        key={key}
        source={marked ?? text}
        marked={marked !== null}
        streaming={streaming}
        muted={muted}
        prose={prose}
        actions={actions}
      />
    )
  }
  if (single || !parts.length) return draw(source)
  return (
    <View style={{ gap: prose.blockGap }}>
      {parts.map((part, index) =>
        part.kind === 'code' ? (
          <CodeBlock key={index} source={part.source} hint={part.lang} />
        ) : part.kind === 'image' ? (
          <MarkdownImage key={index} src={part.src} alt={part.alt} />
        ) : (
          draw(part.source, index)
        ),
      )}
    </View>
  )
}

export function Markdown({
  text,
  density,
  muted,
  streaming,
  fresh,
}: {
  text: string
  /** How it reads: a reply (the default), a card's text, or a whole Markdown file. A quote keeps its message's. */
  density?: ProseDensity
  muted?: boolean
  /** The reply is still arriving: complete its cut-off last line for display, and fade each new block in. */
  streaming?: boolean
  /** The reply started while the chat was open, so even its first block fades in (a reopened chat shows it settled). */
  fresh?: boolean
}) {
  const actions = useContext(ReferenceContext)
  const { textSize } = useTheme()
  const inherited = useContext(ProseContext)
  const prose = useMemo(
    () => (density || !inherited ? phoneProse(density ?? 'reply', TEXT_SCALE[textSize], font) : inherited),
    [density, textSize, inherited],
  )
  const source = useMemo(() => (nativeMarkdown ? nativeMarkdownSource(text) : null), [text])
  const marks = useContext(TextMarkContext)
  const blocks = useMemo(
    () => (source === null ? parseBlocks(streaming ? closePartial(text) : text) : []),
    [source, text, streaming],
  )
  // While a reply streams, the native view draws it a block at a time so each new block can fade in; once it has
  // arrived it is one view again, so a selection runs across all of it.
  const nativeBlocks = useMemo(
    () => (source !== null && streaming ? markdownBlocks(closePartial(source)) : null),
    [source, streaming],
  )
  // Blocks on screen when the reply mounts (a chat opened mid-stream) stay put; blocks that appear later fade in whole,
  // once, on the native driver, so a busy JavaScript thread never stalls them.
  const [settledCount] = useState(() =>
    fresh ? 0 : (nativeBlocks?.length ?? (source !== null ? markdownBlocks(source).length : blocks.length)),
  )
  return (
    <ProseContext.Provider value={prose}>
      {source !== null && nativeBlocks ? (
        <View>
          {nativeBlocks.map((block, index) => (
            <Arrive key={index} animate={index >= settledCount}>
              <NativeParts source={block} streaming muted={muted} actions={actions} />
            </Arrive>
          ))}
        </View>
      ) : source !== null ? (
        <NativeParts source={source} marks={streaming ? null : marks} muted={muted} actions={actions} />
      ) : (
        <View style={{ gap: prose.blockGap, opacity: muted ? 0.8 : 1 }}>
          {blocks.map((block, index) => (
            <Arrive key={index} animate={Boolean(streaming) && index >= settledCount}>
              <BlockView block={block} />
            </Arrive>
          ))}
        </View>
      )}
    </ProseContext.Provider>
  )
}
