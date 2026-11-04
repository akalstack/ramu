import { createContext, isValidElement, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Image, Linking, Platform, ScrollView, StyleSheet, Text, UIManager, View, type TextStyle } from 'react-native'
import { ReferenceBadge } from './ReferenceChip'
export { ReferenceBadge } from './ReferenceChip'
import { CodeBlock } from './Code'
import { Arrive } from './Motion'
import { parseBlocks, splitLongParagraph, type Block } from '../runtime/markdown'
import { chatReferences } from '@ramu/shared/chat/chatReferences'
import { draftChip, skillChip } from '@ramu/shared/chat/referenceChip'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { font, radius, space, useTheme } from '../theme'
import { UITextView } from '@bsky.app/react-native-uitextview'
import { selectedText, type TextRun } from '../runtime/selectedText'
import { NativeMarkdown, nativeMarkdown } from './NativeMarkdown'
import { nativeMarkdownSource } from '../runtime/nativeMarkdownSource'

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

/**
 * Where a message hears what part of it is selected. Inside one, iOS draws each finished block as native selectable
 * text, so a long press picks a word and the handles move by character, as on the desktop. `block` tells blocks apart;
 * `text` is null once that block's selection is cleared.
 */
export const MessageTextSelection = createContext<((block: string, text: string | null) => void) | null>(null)

/** Without the native text view: a long-pressed paragraph opens its message for selecting, starting on that paragraph. */
export const MessageBlockPress = createContext<((block: string) => void) | null>(null)

/**
 * Whether this app binary has the native text view behind word-by-word selection. Expo Go and builds made before it
 * was added do not, and drawing it there fails with "UnimplementedView"; those keep React Native's Text instead.
 */
export const nativeSelection = (() => {
  if (Platform.OS !== 'ios') return false
  try {
    return UIManager.hasViewManagerConfig('RNUITextView') && UIManager.hasViewManagerConfig('RNUITextViewChild')
  } catch {
    return false
  }
})()

/**
 * Spans inside a block. Under a selectable block they join its native text; anywhere else this is React Native's own
 * Text, so one renderer serves both.
 */
const Span = nativeSelection ? UITextView : Text

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

/** Snippets up to this length are drawn as one unbreakable pill; longer ones must wrap, so they stay text. */
const PILL_MAX = 32

/**
 * Inline code as on desktop: 0.88em mono in body color on a small rounded tint. A nested Text cannot round its
 * background and native platforms paint it across the whole line box, so short snippets are an inline View pill,
 * nudged down onto the text baseline. Long snippets wrap as plain mono text with no tint (no tall slabs).
 */
/** Whether a snippet is drawn as an inline pill (one view) rather than as text. */
const isPill = (code: string) => Platform.OS !== 'web' && code.length <= PILL_MAX && !code.includes('\n')

function InlineCode({ code, c }: { code: string; c: ReturnType<typeof useTheme>['c'] }) {
  const type = { fontFamily: font.mono, fontSize: font.control, color: c.text }
  if (Platform.OS === 'web')
    return (
      <Text style={{ ...type, backgroundColor: c.fill, borderRadius: radius.xs, paddingHorizontal: 4 }}>{code}</Text>
    )
  if (!isPill(code)) return <Span style={type}>{code}</Span>
  return (
    <View
      style={{
        backgroundColor: c.fill,
        borderRadius: radius.xs,
        paddingHorizontal: 5,
        transform: [{ translateY: Platform.OS === 'ios' ? 3 : 2 }],
      }}
    >
      <Text style={{ ...type, lineHeight: 18 }}>{code}</Text>
    </View>
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
      if (p.startsWith('`') && p.endsWith('`') && p.length > 1)
        return <InlineCode key={k} code={p.slice(1, -1)} c={c} />
      if (((p.startsWith('**') && p.endsWith('**')) || (p.startsWith('__') && p.endsWith('__'))) && p.length > 4)
        return (
          <Span key={k} style={{ fontWeight: '600', color: c.text }}>
            {inline(p.slice(2, -2), k, c, actions)}
          </Span>
        )
      if (p.startsWith('~~') && p.endsWith('~~') && p.length > 4)
        return (
          <Span key={k} style={{ textDecorationLine: 'line-through', color: c.muted }}>
            {inline(p.slice(2, -2), k, c, actions)}
          </Span>
        )
      if (((/^\*[^*]/.test(p) && p.endsWith('*')) || (/^_[^_]/.test(p) && p.endsWith('_'))) && p.length > 2)
        return (
          <Span key={k} style={{ fontStyle: 'italic' }}>
            {inline(p.slice(1, -1), k, c, actions)}
          </Span>
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
            <Span
              key={k}
              onPress={() => actions.openUrl(url)}
              accessibilityRole="link"
              style={{ color: c.accent, textDecorationLine: 'underline' }}
            >
              {label}
            </Span>
          )
        return label
      }
      return prose(p, actions)
    })
}

/** What each rendered piece copies as, in on-screen order; inline views are one placeholder character natively. */
function textRuns(node: ReactNode, out: TextRun[] = []): TextRun[] {
  if (typeof node === 'string' || typeof node === 'number') out.push({ text: String(node) })
  else if (Array.isArray(node)) for (const child of node) textRuns(child, out)
  else if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; code?: string; chip?: { label: string } }
    if (node.type === InlineCode && props.code !== undefined)
      out.push(isPill(props.code) ? { text: props.code, atom: true } : { text: props.code })
    else if (node.type === ReferenceBadge && props.chip) out.push({ text: props.chip.label, atom: true })
    else textRuns(props.children, out)
  }
  return out
}

/** `live`: the reply is still arriving, so the block stays plain text until it settles, then becomes selectable. */
function Inline({ text, style, live }: { text: string; style?: TextStyle; live?: boolean }) {
  const { c } = useTheme()
  const report = useContext(MessageTextSelection)
  const pressBlock = useContext(MessageBlockPress)
  const block = useId()
  const actions = useContext(ReferenceContext)
  const nodes = inline(text, 'i', c, actions)
  const look = [{ color: c.body, fontSize: font.body, lineHeight: 22 }, style]
  if (nativeSelection && report && !live)
    return (
      <UITextView
        selectable
        uiTextView
        style={look}
        onSelectionChange={({ nativeEvent: { start, end } }) =>
          report(block, end > start ? selectedText(textRuns(nodes), start, end).trim() || null : null)
        }
      >
        {nodes}
      </UITextView>
    )
  return (
    <Text style={look} onLongPress={pressBlock && !live ? () => pressBlock(text) : undefined}>
      {nodes}
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
    <Image
      source={{ uri }}
      accessibilityLabel={alt}
      resizeMode="contain"
      style={{ width: '100%', aspectRatio: ratio, maxHeight: 420, borderRadius: radius.m, backgroundColor: c.fill }}
    />
  )
}

const HEADING = [0, 22, 19, 17, 16, 15, 15]

function BlockView({ block, live }: { block: Block; live?: boolean }) {
  const { c } = useTheme()
  switch (block.kind) {
    case 'code':
      return <CodeBlock source={block.source} hint={block.lang} />
    case 'heading':
      return (
        <Inline
          text={block.text}
          live={live}
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
    case 'paragraph': {
      const pieces = splitLongParagraph(block.text)
      if (pieces.length === 1) return <Inline text={block.text} live={live} />
      return (
        <View>
          {pieces.map((piece, index) => (
            <Inline key={index} text={piece} live={live} />
          ))}
        </View>
      )
    }
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
                    live={live}
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
  fresh,
}: {
  text: string
  muted?: boolean
  /** The reply is still arriving: complete its cut-off last line for display, and fade each new block in. */
  streaming?: boolean
  /** The reply started while the chat was open, so even its first block fades in (a reopened chat shows it settled). */
  fresh?: boolean
}) {
  const actions = useContext(ReferenceContext)
  const source = useMemo(() => (nativeMarkdown ? nativeMarkdownSource(text) : null), [text])
  const blocks = useMemo(
    () => (source === null ? parseBlocks(streaming ? closePartial(text) : text) : []),
    [source, text, streaming],
  )
  // Blocks on screen when the reply mounts (a chat opened mid-stream) stay put; blocks that appear later fade in whole,
  // once, on the native driver, so a busy JavaScript thread never stalls them.
  const [settledCount] = useState(() => (fresh ? 0 : blocks.length))
  if (source !== null) return <NativeMarkdown source={source} streaming={streaming} muted={muted} actions={actions} />
  return (
    <View style={{ gap: space.m, opacity: muted ? 0.8 : 1 }}>
      {blocks.map((block, index) => (
        <Arrive key={index} animate={Boolean(streaming) && index >= settledCount}>
          <BlockView block={block} live={streaming} />
        </Arrive>
      ))}
    </View>
  )
}
