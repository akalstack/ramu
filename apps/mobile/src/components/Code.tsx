import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy } from 'lucide-react-native'
import { codeLanguage } from '@ramu/shared/codeLanguage'
import { font, radius, space, useTheme } from '../theme'
import { grammarFor, highlightLines, type Token } from '../runtime/highlight'
import { tap } from './ui'

export { grammarFor, highlightLines, type Token }

const DARK: Record<string, string> = {
  keyword: '#569CD6', literal: '#569CD6', 'built_in': '#4EC9B0', type: '#4EC9B0', 'title.class': '#4EC9B0', title: '#DCDCAA', 'title.function': '#DCDCAA',
  string: '#CE9178', 'template-tag': '#CE9178', number: '#B5CEA8', symbol: '#B5CEA8', comment: '#6A9955', quote: '#6A9955', doctag: '#608B4E',
  attr: '#9CDCFE', attribute: '#9CDCFE', variable: '#9CDCFE', 'template-variable': '#9CDCFE', params: '#9CDCFE', property: '#9CDCFE',
  tag: '#569CD6', name: '#569CD6', 'selector-tag': '#D7BA7D', 'selector-class': '#D7BA7D', 'selector-id': '#D7BA7D', 'selector-attr': '#D7BA7D',
  regexp: '#D16969', meta: '#C586C0', 'meta keyword': '#C586C0', section: '#569CD6', bullet: '#6796E6', link: '#3794FF', addition: '#B5CEA8', deletion: '#CE9178',
}
const LIGHT: Record<string, string> = {
  keyword: '#0000FF', literal: '#0000FF', 'built_in': '#267F99', type: '#267F99', 'title.class': '#267F99', title: '#795E26', 'title.function': '#795E26',
  string: '#A31515', 'template-tag': '#A31515', number: '#098658', symbol: '#098658', comment: '#008000', quote: '#008000', doctag: '#008000',
  attr: '#001080', attribute: '#001080', variable: '#001080', 'template-variable': '#001080', params: '#001080', property: '#001080',
  tag: '#800000', name: '#800000', 'selector-tag': '#800000', 'selector-class': '#800000', 'selector-id': '#800000', 'selector-attr': '#800000',
  regexp: '#811F3F', meta: '#AF00DB', 'meta keyword': '#AF00DB', section: '#0000FF', bullet: '#0451A5', link: '#0000EE', addition: '#098658', deletion: '#A31515',
}

/** highlight.js scopes look like "hljs-title function_"; the palette is keyed by "title.function", falling back to "title". */
export function useTokenColor() {
  const { scheme } = useTheme()
  const palette = scheme === 'light' ? LIGHT : DARK
  return (scope?: string) => {
    if (!scope) return undefined
    const [first, ...rest] = scope.replace(/hljs-/g, '').split(/\s+/)
    const sub = rest.map(part => part.replace(/_$/, '')).find(Boolean)
    return (sub && palette[`${first}.${sub}`]) ?? palette[first!]
  }
}

/** One line of highlighted tokens, as nested Text so it sits inside any Text (and keeps the line's own font). */
export function CodeTokens({ tokens }: { tokens: Token[] }): ReactNode {
  const color = useTokenColor()
  return tokens.map((token, index) => {
    const tint = color(token.scope)
    const italic = token.scope?.includes('comment') || token.scope?.includes('emphasis')
    const bold = token.scope?.includes('strong')
    return tint || italic || bold ? <Text key={index} style={{ color: tint, fontStyle: italic ? 'italic' : undefined, fontWeight: bold ? '600' : undefined }}>{token.text}</Text> : token.text
  })
}

/** A fenced code block in chat output, like the desktop's: a language label and a copy button over coloured code. */
export function CodeBlock({ source, hint }: { source: string; hint?: string }) {
  const { c } = useTheme()
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer) }, [copied])
  const language = codeLanguage(source, hint)
  const lines = useMemo(() => highlightLines(source, grammarFor(source, hint)), [source, hint])
  const copy = () => { tap(); void Clipboard.setStringAsync(source).then(() => setCopied(true)) }
  return (
    <View style={{ borderRadius: radius.m, backgroundColor: c.code, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.m + 2, paddingRight: 4, height: 34, borderBottomWidth: 0.5, borderBottomColor: c.line }}>
        <Text style={{ color: c.muted, fontSize: font.caption }} numberOfLines={1}>{language.includes('.') ? language : `.${language}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={copied ? 'Copied' : 'Copy code'} hitSlop={6} onPress={copy} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
          {copied ? <Check size={14} color={c.ok} /> : <Copy size={14} color={c.muted} />}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: space.m + 2 }}>
        <Text style={{ fontFamily: font.mono, fontSize: font.caption + 0.5, lineHeight: 18, color: c.soft }}>
          {lines ? lines.map((line, index) => <Text key={index}>{index ? '\n' : ''}<CodeTokens tokens={line} /></Text>) : source}
        </Text>
      </ScrollView>
    </View>
  )
}
