import { memo, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy } from 'lucide-react-native'
import { codeBlockLabel, dedentCode } from '@ramu/shared/workspace/codeLanguage'
import { font, radius, space, useTheme } from '../theme'
import { grammarFor, highlightLines, type Token } from '../runtime/highlight'
import { tap } from './ui'
import { FileIcon } from './FileIcon'
import { useSay } from '../i18n'
import { RowToggle } from './rowToggle'

export { grammarFor, highlightLines, type Token }

const DARK: Record<string, string> = {
  keyword: '#569CD6',
  literal: '#569CD6',
  built_in: '#4EC9B0',
  type: '#4EC9B0',
  'title.class': '#4EC9B0',
  title: '#DCDCAA',
  'title.function': '#DCDCAA',
  string: '#CE9178',
  'template-tag': '#CE9178',
  number: '#B5CEA8',
  symbol: '#B5CEA8',
  comment: '#6A9955',
  quote: '#6A9955',
  doctag: '#608B4E',
  attr: '#9CDCFE',
  attribute: '#9CDCFE',
  variable: '#9CDCFE',
  'template-variable': '#9CDCFE',
  params: '#9CDCFE',
  property: '#9CDCFE',
  tag: '#569CD6',
  name: '#569CD6',
  'selector-tag': '#D7BA7D',
  'selector-class': '#D7BA7D',
  'selector-id': '#D7BA7D',
  'selector-attr': '#D7BA7D',
  regexp: '#D16969',
  meta: '#C586C0',
  'meta keyword': '#C586C0',
  section: '#569CD6',
  bullet: '#6796E6',
  link: '#3794FF',
  addition: '#B5CEA8',
  deletion: '#CE9178',
}
const LIGHT: Record<string, string> = {
  keyword: '#0000FF',
  literal: '#0000FF',
  built_in: '#267F99',
  type: '#267F99',
  'title.class': '#267F99',
  title: '#795E26',
  'title.function': '#795E26',
  string: '#A31515',
  'template-tag': '#A31515',
  number: '#098658',
  symbol: '#098658',
  comment: '#008000',
  quote: '#008000',
  doctag: '#008000',
  attr: '#001080',
  attribute: '#001080',
  variable: '#001080',
  'template-variable': '#001080',
  params: '#001080',
  property: '#001080',
  tag: '#800000',
  name: '#800000',
  'selector-tag': '#800000',
  'selector-class': '#800000',
  'selector-id': '#800000',
  'selector-attr': '#800000',
  regexp: '#811F3F',
  meta: '#AF00DB',
  'meta keyword': '#AF00DB',
  section: '#0000FF',
  bullet: '#0451A5',
  link: '#0000EE',
  addition: '#098658',
  deletion: '#A31515',
}

/** highlight.js scopes look like "hljs-title function_"; the palette is keyed by "title.function", falling back to "title". */
export function useTokenColor() {
  const { scheme } = useTheme()
  const palette = scheme === 'light' ? LIGHT : DARK
  return (scope?: string) => {
    if (!scope) return undefined
    const [first, ...rest] = scope.replace(/hljs-/g, '').split(/\s+/)
    const sub = rest.map((part) => part.replace(/_$/, '')).find(Boolean)
    return (sub && palette[`${first}.${sub}`]) ?? palette[first!]
  }
}

/** One line of highlighted tokens, as nested Text so it sits inside any Text (and keeps the line's own font). */
export const CodeTokens = memo(function CodeTokens({ tokens }: { tokens: Token[] }): ReactNode {
  const color = useTokenColor()
  return tokens.map((token, index) => {
    const tint = color(token.scope)
    const italic = token.scope?.includes('comment') || token.scope?.includes('emphasis')
    const bold = token.scope?.includes('strong')
    return tint || italic || bold ? (
      <Text
        key={index}
        style={{ color: tint, fontStyle: italic ? 'italic' : undefined, fontWeight: bold ? '600' : undefined }}
      >
        {token.text}
      </Text>
    ) : (
      token.text
    )
  })
})

/**
 * A longer block shows its first lines and a "Show all" control. A thread full of generated code otherwise mounts every
 * line of every block at once, which is what made long threads slow to open, and scrolls past screens of code.
 */
const COLLAPSE_OVER = 24
const COLLAPSED_LINES = 14

/**
 * A fenced code block in chat output: a header naming the file, a lone path or the language with its file icon, a copy
 * button that says what it did, and the code without the indentation it inherited from a list.
 */
export function CodeBlock({ source: raw, hint }: { source: string; hint?: string }) {
  const { c } = useTheme()
  const say = useSay()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const toggled = useContext(RowToggle)
  const source = useMemo(() => dedentCode(raw), [raw])
  const header = codeBlockLabel(source, hint)
  const total = useMemo(() => source.split('\n').length, [source])
  const [expanded, setExpanded] = useState(false)
  const collapsed = total > COLLAPSE_OVER && !expanded
  // Only what is shown is highlighted; the grammar is still chosen from the whole block.
  const shown = useMemo(
    () => (collapsed ? source.split('\n').slice(0, COLLAPSED_LINES).join('\n') : source),
    [collapsed, source],
  )
  const lines = useMemo(() => highlightLines(shown, grammarFor(source, hint)), [shown, source, hint])
  const copy = () => {
    tap()
    void Clipboard.setStringAsync(source).then(() => setCopied(true))
  }
  const code = (
    <Text selectable style={{ fontFamily: font.mono, fontSize: font.control, lineHeight: 20, color: c.body }}>
      {lines
        ? lines.map((line, index) => (
            <Text key={index}>
              {index ? '\n' : ''}
              <CodeTokens tokens={line} />
            </Text>
          ))
        : shown}
    </Text>
  )
  return (
    <View
      style={{
        borderRadius: radius.m,
        backgroundColor: c.code,
        borderWidth: 0.5,
        borderColor: c.line,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          paddingLeft: space.m,
          paddingRight: space.xs,
          height: 36,
          backgroundColor: c.fill,
        }}
      >
        <FileIcon path={header.icon} size={14} />
        <Text
          accessibilityLabel={header.title}
          style={{ flex: 1, color: c.soft, fontSize: font.caption, fontWeight: '500' }}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {header.label === 'Path' || header.label === 'Text' ? say(header.label) : header.label}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={say(copied ? 'Copied' : 'Copy code')}
          hitSlop={6}
          onPress={copy}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            height: 28,
            paddingHorizontal: space.s,
            borderRadius: radius.full,
            backgroundColor: pressed ? c.pressed : 'transparent',
          })}
        >
          {copied ? <Check size={13} color={c.ok} /> : <Copy size={13} color={c.muted} />}
          <Text style={{ color: copied ? c.ok : c.muted, fontSize: font.caption }}>
            {say(copied ? 'Copied' : 'Copy')}
          </Text>
        </Pressable>
      </View>
      {/* Code never wraps: a long line scrolls sideways, keeping its indentation readable. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        nestedScrollEnabled
        directionalLockEnabled
        contentContainerStyle={{ paddingHorizontal: space.m, paddingVertical: space.m - 2 }}
      >
        {code}
      </ScrollView>
      {total > COLLAPSE_OVER ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => {
            tap()
            toggled()
            setExpanded((open) => !open)
          }}
          style={({ pressed }) => ({
            minHeight: 36,
            justifyContent: 'center',
            paddingHorizontal: space.m,
            borderTopWidth: 0.5,
            borderTopColor: c.line,
            backgroundColor: pressed ? c.pressed : 'transparent',
          })}
        >
          <Text style={{ color: c.accent, fontSize: font.caption, fontWeight: '500' }}>
            {expanded ? say('Show fewer lines') : say('Show all {0} lines', { 0: total })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
