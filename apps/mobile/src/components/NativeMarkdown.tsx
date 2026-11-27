import { createContext, useContext, useMemo, type ComponentProps } from 'react'
import { Platform, StyleSheet, UIManager, View } from 'react-native'
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown'
import * as Clipboard from 'expo-clipboard'

type ContextMenuItem = NonNullable<ComponentProps<typeof EnrichedMarkdownText>['contextMenuItems']>[number]
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { useSay } from '../i18n'
import { FILE_SCHEME, SKILL_SCHEME } from '../runtime/nativeMarkdownSource'
import { useTheme } from '../theme'
import type { PhoneProse } from '../runtime/prose'
import type { ReferenceActions } from './Markdown'

/**
 * Whether this app binary has the native Markdown view. Builds made before it was added do not, and drawing it there
 * fails, so those keep the React Native renderer.
 */
export const nativeMarkdown = (() => {
  if (Platform.OS === 'web') return false
  try {
    return UIManager.hasViewManagerConfig('EnrichedMarkdownText')
  } catch {
    return false
  }
})()

/** What a selection inside a message can do, beside the system's Copy. Provided by the message around the text. */
export interface MessageSelectionMenu {
  quote(text: string): void
  quoteNew(text: string): void
  aside?(text: string): void
  /** The whole message's actions: copy all, edit or undo from here. */
  more(): void
}
export const MessageSelectionMenuContext = createContext<MessageSelectionMenu | null>(null)

/** The words a find or a quote led to in this row; its messages highlight them instead of the whole row lighting up. */
export const TextMarkContext = createContext<readonly string[] | null>(null)

/**
 * A whole message as one native text view, as T3 Code draws it: selection runs across paragraphs, lists, tables and code
 * with the system's handles and loupe, and the text keeps its formatting while selected.
 */
export function NativeMarkdown({
  source,
  streaming,
  muted,
  marked,
  prose,
  actions,
}: {
  source: string
  streaming?: boolean
  muted?: boolean
  /** The source carries `==` highlight markers, so the parser reads them as highlights. */
  marked?: boolean
  /** The shared reading scale, in points, for this message's density and the text size. */
  prose: PhoneProse
  actions: ReferenceActions
}) {
  const { c, scheme } = useTheme()
  const say = useSay()
  const menu = useContext(MessageSelectionMenuContext)
  const style = useMemo<MarkdownStyle>(() => {
    const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace'
    const body = {
      color: c.body,
      fontSize: prose.size,
      lineHeight: prose.lineHeight,
      marginTop: 0,
      marginBottom: prose.blockGap,
    }
    const heading = (level: number) => ({
      ...body,
      ...prose.headings[level - 1],
      color: c.text,
      fontWeight: '600',
      marginTop: Math.max(0, prose.headingGap - prose.blockGap),
    })
    const block = {
      marginTop: 2,
      marginBottom: prose.blockGap,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
    }
    const dark = scheme === 'dark'
    return {
      paragraph: body,
      h1: heading(1),
      h2: heading(2),
      h3: heading(3),
      h4: heading(4),
      h5: heading(5),
      h6: heading(6),
      strong: { color: c.text },
      link: { color: c.accent, underline: false },
      code: { fontFamily: mono, fontSize: prose.code, color: c.text, backgroundColor: c.fill, borderColor: c.line },
      codeBlock: {
        ...body,
        ...block,
        color: c.body,
        backgroundColor: c.code,
        borderColor: c.line,
        fontFamily: mono,
        fontSize: prose.code,
        lineHeight: prose.codeLineHeight,
        padding: 12,
        syntaxColors: dark
          ? {
              keyword: '#ff7b72',
              string: '#a5d6ff',
              number: '#79c0ff',
              constant: '#79c0ff',
              comment: '#8b949e',
              function: '#d2a8ff',
              type: '#ffa657',
              property: '#79c0ff',
              tag: '#7ee787',
              attribute: '#79c0ff',
            }
          : {
              keyword: '#cf222e',
              string: '#0a3069',
              number: '#0550ae',
              constant: '#0550ae',
              comment: '#6e7781',
              function: '#8250df',
              type: '#953800',
              property: '#0550ae',
              tag: '#116329',
              attribute: '#0550ae',
            },
      },
      // A quote steps back in colour, not so far that it stops reading as text, as on the desktop: a rule at its side and
      // no fill. The library's own fill is near white, which left a quote's light text unreadable in dark mode.
      blockquote: {
        ...body,
        color: c.soft,
        borderColor: c.lineStrong,
        borderWidth: 2,
        gapWidth: 12,
        backgroundColor: 'transparent',
      },
      // As on the desktop: numbers line up in their own column, read a little stronger than bullets, and keep room
      // before the text; items get a little air between them.
      list: {
        ...body,
        bulletColor: c.muted,
        markerColor: c.soft,
        markerFontWeight: '500',
        markerMinWidth: Math.round(prose.size * 1.2),
        gapWidth: 12,
        itemSpacing: prose.itemGap,
      },
      thematicBreak: { color: c.line, height: 1, marginTop: 6, marginBottom: prose.blockGap },
      table: {
        ...body,
        ...block,
        borderColor: c.line,
        headerTextColor: c.text,
        headerBackgroundColor: c.code,
        rowEvenBackgroundColor: 'transparent',
        rowOddBackgroundColor: 'transparent',
        cellPaddingHorizontal: 10,
        cellPaddingVertical: 7,
      },
      taskList: { checkedColor: c.accent, checkedTextColor: c.body, borderColor: c.muted, checkedStrikethrough: false },
      highlight: { color: c.text, backgroundColor: c.mark },
    } as MarkdownStyle
  }, [c, scheme, prose])
  const menuItems = useMemo<ContextMenuItem[] | undefined>(
    () =>
      menu
        ? [
            // Copy first, as every iOS selection menu starts; the system's own Copy follows the custom items.
            { text: say('Copy'), onPress: ({ text }) => void Clipboard.setStringAsync(text) },
            { text: say('Quote'), onPress: ({ text }) => menu.quote(text) },
            { text: say('New thread'), onPress: ({ text }) => menu.quoteNew(text) },
            ...(menu.aside
              ? [{ text: say('Ask aside'), onPress: ({ text }: { text: string }) => menu.aside!(text) }]
              : []),
            { text: say('More'), onPress: () => menu.more() },
          ]
        : undefined,
    [menu, say],
  )
  return (
    <View style={{ opacity: muted ? 0.8 : 1 }}>
      <EnrichedMarkdownText
        markdown={source}
        markdownStyle={style}
        flavor="github"
        md4cFlags={marked ? { highlight: true } : undefined}
        selectable
        selectionColor={c.accent}
        streamingAnimation={streaming}
        enableTaskListItemToggle={false}
        contextMenuItems={menuItems}
        selectionMenuConfig={{ copy: { label: say('Copy') }, copyAsMarkdown: { label: say('Copy as Markdown') } }}
        onLinkPress={({ url }) => {
          if (url.startsWith(SKILL_SCHEME))
            return actions.openSkill?.(decodeURIComponent(url.slice(SKILL_SCHEME.length)))
          if (url.startsWith(FILE_SCHEME)) return actions.openFile(decodeURIComponent(url.slice(FILE_SCHEME.length)))
          if (/^https?:\/\//i.test(url)) return actions.openUrl(url)
          if (localFileLink(url)) actions.openFile(url)
        }}
        containerStyle={{ flexShrink: 1, minWidth: 0 }}
      />
    </View>
  )
}
