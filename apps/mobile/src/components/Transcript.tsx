import { MEDIA_SERVICE_NAMES } from '@ramu/shared/types/media'
import { MessageSelectionMenuContext, TextMarkContext, nativeMarkdown } from './NativeMarkdown'
import { markSource } from '../runtime/textMark'
import { ContinuedCard } from './ContinueOnHost'
import { toolActivity } from '@ramu/shared/chat/toolActivity'
import { thoughtLine } from '@ramu/shared/chat/thoughtLine'
import { FileIcon } from './FileIcon'
import { isModelFile, ModelTile } from './ModelViewer'
import { translate, type Language } from '@ramu/shared/i18n'
import { toolVerb } from '@ramu/shared/chat/toolStatus'
import { DiffLines } from './DiffLines'
import { changedFile } from '../runtime/diff'
import { Helpers, ReportCard, TeammateTo } from './Helpers'
import { InteractiveContent, InteractiveOlderVersion } from './InteractiveContent'
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActionSheetIOS,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { readableRuns, readableText, type ReadableStyle } from '../runtime/transcript'
import type { Attachment } from '@ramu/shared/types'
import { useRouter } from 'expo-router'
import { ABILITY_DONE, ABILITY_LABELS, isMediaAbility, type AbilityCall } from '@ramu/shared/providers/abilities'
import { providerName } from '@ramu/shared/providers/providers'
import {
  Check,
  Copy,
  FileCode2,
  FilePen,
  GitFork,
  ChevronRight,
  FileDiff,
  Flag,
  Globe,
  Lightbulb,
  Brain,
  Search,
  ShieldAlert,
  SquareTerminal,
  Wrench,
  X,
  Target,
  Play,
  CirclePause,
  CircleAlert,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { fill, useT, useSay } from '../i18n'
import { agentErrorView } from '@ramu/shared/chat/agentErrorView'
import { endedOnError } from '../runtime/turns'
import { showError } from '../runtime/toast'
import { accountName } from '@ramu/shared/providers/providers'
import { providerNames, type Chat, type ToolKind, type TranscriptItem } from '../runtime/types'
import { useStore } from '../runtime/store'
import {
  Markdown,
  MessageBlockPress,
  MessageTextSelection,
  nativeSelection,
  ReferenceBadge,
  ReferenceContext,
} from './Markdown'
import { draftChip } from '@ramu/shared/chat/referenceChip'
import { composerDraft, type DraftMention } from '@ramu/shared/chat/composerDraft'
import { useOpenFile } from '../runtime/openFile'
import { Button, Card, Chip, Sheet, T, tap, type Icon } from './ui'
import type { ElicitationField } from '@ramu/shared/types'
import { ActivityText, Arrive, Breathe, Collapse, Disclosure, Shimmer } from './Motion'
import { Glow } from './Glow'
import { InteractiveVisibility } from './InteractiveVisibility'
import { ProviderIcon } from './Logos'
import { ThemeProposal } from './ThemeProposal'

const toolIcons: Record<ToolKind, Icon> = {
  read: FileCode2,
  edit: FilePen,
  search: Search,
  execute: SquareTerminal,
  think: Lightbulb,
  fetch: Globe,
  other: Wrench,
}

export { RowToggle } from './rowToggle'
import { messagePreview } from '../runtime/messagePreview'
import { RowToggle } from './rowToggle'
import { RamuGlyph } from './AnimatedMark'
import { PullRequestWritesCard } from './PullRequestWritesCard'
import { TestDeviceWaitCard } from './TestDeviceWaitCard'
import { SettingsChangeCard } from './SettingsChangeCard'

/** Drops the model change waiting for the next send; set by the chat screen that holds it. */
export const CancelPendingSettings = createContext<() => void>(() => {})

/** Who the thread's messages can start with, so a sent `@sonnet-5.5` reads as that model, as it did in the composer. */
export const ChatMentions = createContext<readonly DraftMention[]>([])

/** Gives every badge in a chat the chat's file opener. */
export function ChatReferences({ chat, children }: { chat: Chat; children: ReactNode }) {
  const files = useOpenFile(chat)
  const store = useStore()
  // The actions read the latest store and opener when called. Their identity changes only with the chat they act on,
  // so a store update does not redraw every link and badge in every mounted message.
  const latest = useRef({ files, store })
  latest.current = { files, store }
  const { computerId, taskId } = chat
  const actions = useMemo(
    () => ({
      image: async (href: string) => {
        if (!taskId) return null
        const { store } = latest.current
        const file = await store.invoke(computerId, 'files.resolveLink', taskId, href)
        return file ? (await store.invoke(computerId, 'files.media', taskId, file.repoId, file.path)).url : null
      },
      openFile: (href: string) => void latest.current.files.openLink(href),
      openUrl: (url: string) => void Linking.openURL(url).catch(() => {}),
    }),
    [computerId, taskId],
  )
  return <ReferenceContext.Provider value={actions}>{children}</ReferenceContext.Provider>
}

/** What a long-pressed message can do, as the desktop's selection menu: quote it into the message box, or ask an aside about it. */
export const MessageMenu = createContext<{
  readOnly?: boolean
  quote(text: string): void
  quoteNew(text: string): void
  edit(seq: number, text: string, files: Attachment[]): void
  undo(seq: number): void
  aside(text: string, from: 'user' | 'assistant'): void
  /** The text selected in a message, for the bar over the message box; null when nothing is selected. */
  select(selection: MessageSelection | null): void
  /** Scrolls the chat to a row, such as a document's newest version. */
  goTo?(itemId: string): void
} | null>(null)

export interface MessageSelection {
  text: string
  from: 'user' | 'assistant'
  /** The rest of what the message offers: edit, undo. */
  more(): void
  done(): void
}

/**
 * A message opened for selecting, in place, where this app has no native text view: the system's own handles, loupe and
 * word snapping, which React Native's Text cannot report. It reads like the message (headings, bold, code and bullets
 * keep their look) and starts on the paragraph that was pressed. It is an input only for that: no keyboard, and its text
 * cannot change.
 */
function SelectableMessage({
  text,
  block,
  from,
  more,
  done,
}: {
  text: string
  /** The paragraph that was long-pressed, selected first; without one, the whole message is. */
  block: string | null
  from: 'user' | 'assistant'
  more(): void
  done(): void
}) {
  const { c } = useTheme()
  const menu = useContext(MessageMenu)
  const runs = useMemo(() => readableRuns(text), [text])
  const readable = useMemo(() => runs.map((run) => run.text).join(''), [runs])
  const [range, setRange] = useState(() => {
    const pressed = block ? readableText(block) : ''
    const start = pressed ? readable.indexOf(pressed) : -1
    return start < 0 ? { start: 0, end: readable.length } : { start, end: start + pressed.length }
  })
  const look: Record<ReadableStyle, TextStyle> = {
    body: {},
    strong: { fontWeight: '600', color: c.text },
    em: { fontStyle: 'italic' },
    code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: font.body - 2 },
    heading: { fontWeight: '700', color: c.text, fontSize: font.body + 2 },
    marker: { color: c.muted },
  }
  const picked = readable.slice(range.start, range.end).trim()
  const select = menu?.select
  useEffect(() => {
    select?.({ text: picked || readable, from, more, done })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `more` and `done` are new each render; the text decides
  }, [select, picked, readable, from])
  useEffect(() => () => select?.(null), [select])
  return (
    <TextInput
      autoFocus
      multiline
      scrollEnabled={false}
      selection={range}
      onSelectionChange={(event) => setRange(event.nativeEvent.selection)}
      onBlur={done}
      showSoftInputOnFocus={false}
      contextMenuHidden
      caretHidden
      selectionColor={c.accent}
      accessibilityLabel={readable}
      style={{ color: c.body, fontSize: font.body, lineHeight: 22, padding: 0, textAlignVertical: 'top' }}
    >
      <Text>
        {runs.map((run, index) => (
          <Text key={index} style={look[run.style]}>
            {run.text}
          </Text>
        ))}
      </Text>
    </TextInput>
  )
}

/**
 * Selecting a message's text brings up the bar over the message box, which acts on the selection as on the desktop.
 * Where iOS has the native text view, the text is natively selectable: a long press picks a word and the handles move by
 * character. Elsewhere a long press opens the message for selecting in place. Either way "More" offers the whole
 * message's actions.
 */
function MessageActions({
  text,
  from,
  seq,
  files,
  markdown,
  children,
}: {
  text: string
  from: 'user' | 'assistant'
  seq?: number
  files?: Attachment[]
  /** The message is Markdown, which iOS draws as native selectable text. */
  markdown?: boolean
  children: ReactNode
}) {
  const menu = useContext(MessageMenu)
  const say = useSay()
  const latestMenu = useRef(menu)
  latestMenu.current = menu
  // The message open for selecting, and the paragraph that was pressed to open it.
  const [selecting, setSelecting] = useState<{ block: string | null } | null>(null)
  // A native selection, by block, so clearing one block does not drop another's; `clears` remounts to clear them all.
  const picked = useRef<string | null>(null)
  const [clears, setClears] = useState(0)
  const select = menu?.select
  // The native Markdown view selects across the whole message and carries its own menu, as T3 Code's does.
  const whole = nativeMarkdown && !!markdown
  const native = !whole && nativeSelection && !!select && !!markdown
  const report = useMemo(
    () =>
      native
        ? (block: string, value: string | null) => {
            if (value) {
              picked.current = block
              select({
                text: value,
                from,
                more: () => openRef.current(),
                done: () => {
                  picked.current = null
                  select(null)
                  setClears((n) => n + 1)
                },
              })
            } else if (picked.current === block) {
              picked.current = null
              select(null)
            }
          }
        : null,
    [native, select, from],
  )
  useEffect(() => () => void (picked.current && select?.(null)), [select])
  const openRef = useRef<() => void>(() => {})
  const open = () => {
    if (!text.trim()) return
    const actions: [string, () => void][] = [
      [say('Copy'), () => void Clipboard.setStringAsync(text)],
      ...(menu
        ? ([
            [say('Quote in reply'), () => menu.quote(text)],
            [say('Quote in new thread'), () => menu.quoteNew(text)],
            ...(!menu.readOnly && from === 'user' && seq !== undefined
              ? ([
                  [
                    say('Edit from here'),
                    () => !latestMenu.current?.readOnly && latestMenu.current?.edit(seq, text, files ?? []),
                  ],
                  [
                    say('Undo file changes from here'),
                    () => !latestMenu.current?.readOnly && latestMenu.current?.undo(seq),
                  ],
                ] as [string, () => void][])
              : []),
            ...(!menu.readOnly
              ? ([
                  [
                    say('Ask aside about this'),
                    () => !latestMenu.current?.readOnly && latestMenu.current?.aside(text, from),
                  ],
                ] as [string, () => void][])
              : []),
          ] as [string, () => void][])
        : []),
    ]
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...actions.map((a) => a[0]), say('Cancel')], cancelButtonIndex: actions.length },
        (index) => actions[index]?.[1](),
      )
    else
      Alert.alert(say('Message'), undefined, [
        ...actions.map(([label, run]) => ({ text: label, onPress: run })),
        { text: say('Cancel'), style: 'cancel' as const },
      ])
  }
  openRef.current = open
  const startSelecting = (block: string | null) => {
    if (!text.trim()) return
    tap()
    if (menu) setSelecting({ block })
    else open()
  }
  if (selecting)
    return (
      <SelectableMessage text={text} block={selecting.block} from={from} more={open} done={() => setSelecting(null)} />
    )
  if (whole)
    return (
      <MessageSelectionMenuContext.Provider
        value={
          menu
            ? {
                quote: (picked) => menu.quote(picked),
                quoteNew: (picked) => menu.quoteNew(picked),
                aside: menu.readOnly ? undefined : (picked) => latestMenu.current?.aside(picked, from),
                more: () => openRef.current(),
              }
            : { quote: () => {}, quoteNew: () => {}, more: () => openRef.current() }
        }
      >
        {children}
      </MessageSelectionMenuContext.Provider>
    )
  return (
    <Pressable
      // On iOS a long press selects a word natively, so the message itself takes none; "More" in the bar has the rest.
      onLongPress={native ? undefined : () => startSelecting(null)}
      delayLongPress={350}
      accessibilityHint={say('Long-press to select text')}
    >
      <MessageTextSelection.Provider value={report}>
        <MessageBlockPress.Provider value={native ? null : startSelecting}>
          <View key={clears}>{children}</View>
        </MessageBlockPress.Provider>
      </MessageTextSelection.Provider>
    </Pressable>
  )
}

/** An image in the chat: fits the column, keeps its aspect ratio, and opens full screen when tapped. */
function ImageBlock({ uri, alt, size }: { uri: string; alt?: string; size?: number }) {
  const say = useSay()
  const { c } = useTheme()
  const [ratio, setRatio] = useState(4 / 3)
  const [full, setFull] = useState(false)
  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => {
        if (w && h) setRatio(w / h)
      },
      () => {},
    )
  }, [uri])
  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={alt ?? say('Image')}
        onPress={() => {
          tap()
          setFull(true)
        }}
      >
        <Image
          source={{ uri }}
          resizeMode="cover"
          style={
            size
              ? { width: size, height: size, borderRadius: radius.s, backgroundColor: c.fill }
              : { width: '100%', maxWidth: 360, aspectRatio: ratio, borderRadius: radius.m, backgroundColor: c.fill }
          }
        />
      </Pressable>
      <Sheet open={full} onClose={() => setFull(false)} title={alt ?? say('Image')}>
        <Card style={{ marginHorizontal: space.l, padding: space.s }}>
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={{ width: '100%', aspectRatio: ratio, maxHeight: 520, borderRadius: radius.s }}
          />
        </Card>
      </Sheet>
    </>
  )
}

/** A file you attached: images show as thumbnails (fetched from the computer), other files as a chip. */
function AttachmentTile({ file, chat }: { file: Attachment; chat: Chat }) {
  const { c } = useTheme()
  const store = useStore()
  const image = file.mimeType.startsWith('image/')
  const [uri, setUri] = useState<string | null>(null)
  useEffect(() => {
    if (!image || !store.isOnline(chat.computerId)) return
    let alive = true
    void store.invoke(chat.computerId, 'attachments.preview', file.id).then(
      (value) => {
        if (alive) setUri(value)
      },
      () => {},
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [file.id, image, chat.computerId] by design; the values it reads beyond these are current as of that run
  }, [file.id, image, chat.computerId])
  if (image && uri) return <ImageBlock uri={uri} alt={file.name} size={88} />
  if (isModelFile(file)) return <ModelTile file={file} computerId={chat.computerId} />
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 26,
        paddingHorizontal: 8,
        borderRadius: radius.s,
        backgroundColor: c.fill,
        maxWidth: 220,
      }}
    >
      <T size={font.caption + 1} tone="soft" numberOfLines={1}>{`📎 ${file.name}`}</T>
    </View>
  )
}

/** An ability call: where it ran, what was sent, the result, and running it again from the phone. */
function AbilityCard({ call, chat }: { call: AbilityCall; chat: Chat }) {
  const say = useSay()
  const store = useStore()
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const done = call.status === 'done'
  const image = call.ability === 'image_generation' || call.ability === 'image_edit'
  const runner = call.mcp
    ? call.mcp.server
    : call.media
      ? MEDIA_SERVICE_NAMES[call.media]
      : call.provider === 'ramu'
        ? say("Ramu's search")
        : call.provider
          ? providerName(call.provider)
          : ''
  const headline = done
    ? say(ABILITY_DONE[call.ability], { '0': runner })
    : say(call.status === 'refused' ? '{0} not used' : '{0} failed', { '0': say(ABILITY_LABELS[call.ability]) })
  const online = store.isOnline(chat.computerId) && !!chat.sessionId
  const again = (other: boolean) => {
    setRunning(true)
    void store
      .invoke(chat.computerId, 'abilities.again', chat.sessionId!, call.id, other)
      .catch(() => {})
      .finally(() => setRunning(false))
  }
  return (
    <Card style={{ padding: space.m, gap: space.s }}>
      <T weight="600" numberOfLines={2} tone={done ? undefined : 'bad'}>
        {headline}
      </T>
      {call.model ? (
        <T size={font.caption} tone="muted" numberOfLines={1}>
          {call.cheapest ? `${call.model} · ${say('chosen as the cheapest good enough')}` : call.model}
        </T>
      ) : null}
      {call.credits !== undefined ? (
        <T size={font.caption} tone="muted" numberOfLines={1}>
          {say('{0} credits left', { '0': call.credits.toLocaleString() })}
        </T>
      ) : null}
      {call.sent.prompt ? (
        <T
          size={font.caption}
          tone="muted"
        >{`${say('Sent')}: “${call.sent.prompt}”${call.sent.inputs.length ? ` · ${call.sent.inputs.join(', ')}` : ''}`}</T>
      ) : null}
      {call.attachments?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {call.attachments.map((file) => (
            <AttachmentTile key={file.id} file={file} chat={chat} />
          ))}
        </View>
      ) : null}
      {(!done || !image) && call.summary ? (
        <T size={font.caption} tone="soft" numberOfLines={done ? 12 : 4}>
          {call.summary}
        </T>
      ) : null}
      {online ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {done && image ? (
            <Button kind="secondary" title={say('Make another')} disabled={running} onPress={() => again(false)} />
          ) : null}
          {done && call.provider !== 'ramu' && !call.mcp && !call.media ? (
            <Button kind="ghost" title={say('Use another provider')} disabled={running} onPress={() => again(true)} />
          ) : null}
          {call.refusal === 'unavailable' || (call.ability === 'model_3d' && call.status === 'failed' && call.mcp) ? (
            <Button
              kind="secondary"
              title={
                call.ability === 'model_3d'
                  ? say('Open plugins')
                  : isMediaAbility(call.ability)
                    ? say('Add a media key')
                    : say('Set up a provider')
              }
              onPress={() =>
                router.push({
                  pathname: '/settings/[section]',
                  params: { section: call.ability === 'model_3d' ? 'plugins' : 'providers' },
                })
              }
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  )
}

/** What the chat screen knows about an item's place in the conversation. */
export interface ItemMeta {
  /** A centred "Today 6:13 PM" above this message: the first one, a new day, or after a pause (the desktop's rule). */
  date?: string
  /** The last answer of its turn: shows its time and a copy button underneath. */
  footer?: boolean
  /** The reply is still arriving, so its cut-off last line is completed for display and each new block fades in. */
  streaming?: boolean
  /** The reply began while this chat was open, so its first block fades in too. */
  fresh?: boolean
}

/** What rows read from their chat; any other change to the chat leaves them as drawn. */
const rowChatKey = (chat: Chat) =>
  [
    chat.id,
    chat.computerId,
    chat.sessionId,
    chat.taskId,
    chat.status,
    chat.executionState,
    chat.provider,
    chat.model,
  ].join('\u0000')
interface RowProps {
  item: TranscriptItem
  chat: Chat
  date?: string
  footer?: boolean
  streaming: boolean
  fresh: boolean
  visible: boolean
  /** Set when a quote's Show in conversation or a find led here: the row lights up once per value. */
  found?: number
  /** The words that led here. A message highlights them in place; the whole row lights up only when it cannot. */
  mark?: readonly string[]
}
/** Rows that read the rest of the chat: an error offers Retry only while it ended the thread; teammates read it whole. */
const READS_ITEMS = new Set<TranscriptItem['kind']>(['error', 'agents'])

/**
 * A chat list row. It re-renders only when its own row, its place in the thread or what rows read from the chat
 * changes, so streaming into the last row or a status tick does not redraw the rest of a long thread.
 */
export const TranscriptListRow = memo(function TranscriptListRow({
  item,
  chat,
  date,
  footer,
  streaming,
  fresh,
  visible,
  found,
  mark,
}: RowProps) {
  const meta = useMemo(() => ({ date, footer, streaming, fresh }), [date, footer, streaming, fresh])
  const inText = useMemo(() => {
    if (!mark?.length || !nativeMarkdown) return false
    // A report opens folded, so words inside it would not show; it lights up whole instead.
    const text = item.kind === 'user' || item.kind === 'text' || item.kind === 'teammate-message' ? item.text : null
    return text !== null && markSource(text, mark) !== null
  }, [item, mark])
  return (
    <Arrive animate={fresh}>
      <InteractiveVisibility.Provider value={visible}>
        <TextMarkContext.Provider value={inText ? mark! : null}>
          <Glow pulse={inText ? null : (found ?? null)} delay={350}>
            <TranscriptItemView item={item} chat={chat} meta={meta} />
          </Glow>
        </TextMarkContext.Provider>
      </InteractiveVisibility.Provider>
    </Arrive>
  )
}, sameRow)

function sameRow(previous: RowProps, next: RowProps): boolean {
  return (
    previous.item === next.item &&
    previous.date === next.date &&
    previous.footer === next.footer &&
    previous.streaming === next.streaming &&
    previous.fresh === next.fresh &&
    previous.visible === next.visible &&
    previous.found === next.found &&
    previous.mark === next.mark &&
    (previous.chat === next.chat ||
      (!READS_ITEMS.has(next.item.kind) && rowChatKey(previous.chat) === rowChatKey(next.chat)))
  )
}

export function TranscriptItemView({ item, chat, meta }: { item: TranscriptItem; chat: Chat; meta?: ItemMeta }) {
  return (
    <ChatReferences chat={chat}>
      {meta?.date ? (
        <T
          size={font.caption}
          tone="muted"
          style={{ textAlign: 'center', marginBottom: space.l, fontVariant: ['tabular-nums'] }}
          accessibilityRole="header"
        >
          {meta.date}
        </T>
      ) : null}
      <TranscriptBlock item={item} chat={chat} meta={meta} />
    </ChatReferences>
  )
}

/** Time of an answer and a copy button, like the desktop's row under each reply. */
const AnswerFooter = memo(function AnswerFooter({ at, text }: { at?: number; text: string }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const time = at
    ? new Date(at).toLocaleTimeString(store.language === 'id' ? 'id-ID' : 'en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: store.language === 'en',
      })
    : ''
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs }}>
      {time ? (
        <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {time}
        </T>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? say('Copied') : say('Copy reply')}
        hitSlop={10}
        onPress={() => {
          tap()
          void Clipboard.setStringAsync(text).then(() => setCopied(true))
        }}
        style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
      >
        {copied ? <Check size={14} color={c.ok} /> : <Copy size={14} color={c.muted} />}
      </Pressable>
    </View>
  )
})

const RESUME_PROMPT = '\n\n<ramu-context>\nContinue where you left off.\n</ramu-context>'

/** An error in the thread, in the same words as the desktop: what happened, then the provider's message. */
function ErrorCard({ message, last, chat }: { message: string; last: boolean; chat: Chat }) {
  const { c } = useTheme()
  const say = useSay()
  const store = useStore()
  const { title, action } = agentErrorView(message)
  const canRetry =
    action === 'retry' &&
    last &&
    !!chat.sessionId &&
    chat.status !== 'running' &&
    chat.status !== 'needs-input' &&
    chat.executionState !== 'running' &&
    chat.executionState !== 'starting' &&
    store.isOnline(chat.computerId) &&
    store.computers?.find((host) => host.id === chat.computerId)?.access !== 'viewer'
  return (
    <MessageActions text={message} from="assistant">
      <View
        accessibilityRole="alert"
        style={{
          flexDirection: 'row',
          gap: space.s,
          padding: space.m,
          borderRadius: radius.m,
          backgroundColor: c.raised,
        }}
      >
        <CircleAlert size={15} color={c.bad} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={font.control} weight="600">
            {say(title)}
          </T>
          <T size={font.control} tone="muted">
            {message}
          </T>
          {canRetry ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                tap()
                void store
                  .invoke(chat.computerId, 'agent.submit', chat.sessionId!, RESUME_PROMPT, 'steer', [], [])
                  .catch((error) => showError(error instanceof Error ? error.message : String(error)))
              }}
              style={{ alignSelf: 'flex-start', paddingVertical: space.s }}
            >
              <T size={font.control} weight="600" tone="accent">
                {say('Try again')}
              </T>
            </Pressable>
          ) : null}
        </View>
      </View>
    </MessageActions>
  )
}

function TranscriptBlock({ item, chat, meta }: { item: TranscriptItem; chat: Chat; meta?: ItemMeta }) {
  switch (item.kind) {
    case 'user':
      if (item.from) return <ThreadMessageCard from={item.from} chat={chat} />
      return (
        <MessageActions text={item.text} from="user" seq={item.seq} files={item.attachments} markdown>
          <UserBubble text={item.text} attachments={item.attachments} chat={chat} />
        </MessageActions>
      )
    case 'error':
      return <ErrorCard message={item.message} last={endedOnError(chat.items, item.id)} chat={chat} />
    case 'text':
      return (
        <MessageActions text={item.text} from="assistant" markdown>
          <Markdown text={item.text} streaming={meta?.streaming} fresh={meta?.fresh} />
          {meta?.footer && !meta.streaming ? <AnswerFooter at={item.at} text={item.text} /> : null}
        </MessageActions>
      )
    case 'thinking':
      return <ThinkingRow text={item.text} live={Boolean(meta?.streaming)} />
    case 'interactive':
      return item.replacedBy ? (
        <InteractiveVersionRow reference={item.reference} replacedBy={item.replacedBy} chat={chat} />
      ) : (
        <InteractiveBlock reference={item.reference} previous={item.previous} update={item.update} chat={chat} />
      )
    case 'image':
      return <ImageBlock uri={item.uri} alt={item.alt} />
    case 'theme':
      return <ThemeProposal theme={item.theme} />
    case 'ability':
      return <AbilityCard call={item.call} chat={chat} />
    case 'threads':
      return <StartedThreadsCard threads={item.threads} chat={chat} />
    case 'pull-request-writes':
      return <PullRequestWritesCard computerId={chat.computerId} cardId={item.cardId} />
    case 'test-device-wait':
      return <TestDeviceWaitCard computerId={chat.computerId} taskId={chat.taskId} platform={item.platform} />
    case 'settings-change':
      return <SettingsChangeCard computerId={chat.computerId} cardId={item.cardId} />
    case 'continued':
      return <ContinuedCard event={item.event} chat={chat} />
    case 'tool':
      return <ToolRow item={item} />
    case 'tools':
      return <ToolGroup item={item} live={Boolean(meta?.streaming)} />
    case 'plan':
      return <PlanCard item={item} />
    case 'agents':
      return <AgentsGroup item={item} chat={chat} />
    case 'report':
      return <ReportCard item={item} chat={chat} />
    case 'teammate-message':
      return (
        <MessageActions text={item.text} from="user" markdown>
          <View style={{ gap: space.xs }}>
            <TeammateTo teammateId={item.teammateId} name={item.name} chat={chat} />
            <UserBubble text={item.text} chat={chat} />
          </View>
        </MessageActions>
      )
    case 'question':
      return <QuestionCard item={item} chatId={chat.id} />
    case 'permission':
      return <PermissionCard item={item} chatId={chat.id} />
    case 'elicitation':
      return <ElicitationCard item={item} chatId={chat.id} />
    case 'secret':
      return <SecretCard item={item} chatId={chat.id} />
    case 'changes':
      return <ChangesCard item={item} chatId={chat.id} />
    case 'goal':
      return <GoalDone item={item} />
    case 'summary':
      return (
        <TurnSummary label={item.label}>
          {item.items.map((child) => (
            <TranscriptItemView key={child.id} item={child} chat={chat} />
          ))}
        </TurnSummary>
      )
    case 'note':
      return item.goalNote ? <GoalNote item={item} /> : <NoteRow item={item} chat={chat} />
    case 'end':
      return null
  }
}

/** Threads this thread's agent started, as on the desktop: one row each, opening that thread. */
function StartedThreadsCard({ threads, chat }: { threads: import('@ramu/shared/types').StartedThread[]; chat: Chat }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const router = useRouter()
  return (
    <Card style={{ marginVertical: space.s, padding: space.m, gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <GitFork size={16} color={c.text} />
        <T weight="600">
          {threads.length === 1 ? say('Started a thread') : say('Started {0} threads', { '0': threads.length })}
        </T>
      </View>
      {threads.map((thread, index) => {
        const open =
          thread.taskId && !thread.host
            ? () => {
                tap()
                router.push({
                  pathname: '/chat/[id]',
                  params: { id: store.resolveChat(chat.computerId, thread.taskId) },
                })
              }
            : undefined
        return (
          <Pressable
            key={thread.taskId || index}
            onPress={open}
            disabled={!open}
            accessibilityRole={open ? 'button' : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 36 }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <T numberOfLines={1}>{thread.title}</T>
              <T size={font.caption} tone={thread.error ? 'bad' : 'muted'} numberOfLines={2}>
                {thread.error ??
                  [
                    thread.projectName,
                    thread.host ? say('on {0}', { '0': thread.host }) : '',
                    thread.pending ? say('Waiting for {0}', { '0': thread.host ?? '' }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
              </T>
            </View>
            {open && <ChevronRight size={16} color={c.muted} />}
          </Pressable>
        )
      })}
    </Card>
  )
}

const REPORT_TITLES: Record<import('@ramu/shared/types').ThreadReportOutcome, string> = {
  completed: '{0} finished',
  'needs-input': '{0} is waiting for you',
  failed: '{0} failed',
  interrupted: '{0} was interrupted',
  cancelled: '{0} was stopped',
}

/** A report or note another thread sent this one, as on the desktop: who sent it, its words folded, and a way there. */
function ThreadMessageCard({ from, chat }: { from: import('@ramu/shared/types').MessageOrigin; chat: Chat }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const router = useRouter()
  const report = from.kind === 'thread-report'
  const [open, setOpen] = useState(!report)
  const title = report
    ? say(REPORT_TITLES[from.outcome], { '0': from.title })
    : say('Message from {0}', { '0': from.title })
  const go =
    from.taskId && !from.host
      ? () => {
          tap()
          router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(chat.computerId, from.taskId!) } })
        }
      : undefined
  return (
    <Card
      style={{
        marginVertical: space.s,
        padding: space.m,
        gap: space.s,
        ...(report && from.outcome === 'failed' ? { borderLeftWidth: 2, borderLeftColor: c.bad } : {}),
      }}
    >
      <Pressable
        onPress={go}
        disabled={!go}
        accessibilityRole={go ? 'button' : undefined}
        accessibilityHint={go ? say('Open thread') : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}
      >
        <GitFork size={16} color={c.muted} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T weight="600" numberOfLines={2}>
            {title}
          </T>
          {from.host ? (
            <T size={font.caption} tone="muted">
              {say('on {0}', { '0': from.host })}
            </T>
          ) : null}
        </View>
        {go ? <ChevronRight size={16} color={c.muted} /> : null}
      </Pressable>
      {from.detail ? (
        <View>
          <Pressable
            onPress={() => {
              tap()
              setOpen((value) => !value)
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 }}
          >
            <T size={font.caption} tone="muted">
              {report ? say('Report') : say('Message')}
            </T>
            <Disclosure open={open} size={12} color={c.muted} />
          </Pressable>
          <Collapse open={open}>
            <Markdown text={from.detail} />
          </Collapse>
        </View>
      ) : null}
    </Card>
  )
}

const ACCESS = { edits: 'Allow edits', auto: 'Auto', full: 'Full access' } as const
/** A status line with a rule on both sides, like the desktop's separators: "Opus Medium" over "Changed conversation settings". */
function NoteRow({ item, chat }: { item: Extract<TranscriptItem, { kind: 'note' }>; chat: Chat }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const strings = useT()
  const [undoing, setUndoing] = useState(false)
  const cancelPending = useContext(CancelPendingSettings)
  // As on the desktop: a settings change can be undone, restoring the previous settings for the next message.
  const undo =
    item.previous && chat.sessionId && !item.pending
      ? () => {
          tap()
          setUndoing(true)
          void store
            .invoke(chat.computerId, 'agent.configure', chat.sessionId!, item.previous!)
            .then(() => store.refresh(chat.computerId, true))
            .catch((error) =>
              Alert.alert(say('Could not switch back'), error instanceof Error ? error.message : String(error)),
            )
            .finally(() => setUndoing(false))
        }
      : undefined
  const catalogs = store.catalogs[store.selected] ?? []
  const label = (s: import('@ramu/shared/types').AgentSettings) => {
    const model = catalogs
      .flatMap((p) => p.models)
      .find((m) => m.provider === s.provider && (m.id === s.model || (!s.model && m.isDefault)))
    const name = (model?.name ?? (s.model || providerNames[s.provider])).replace(/^gpt-/i, 'GPT-')
    const effort = s.effort ?? model?.defaultEffort
    return effort ? `${name} ${effort.charAt(0).toUpperCase()}${effort.slice(1)}` : name
  }
  const loginName = (s: import('@ramu/shared/types').AgentSettings) =>
    accountName(
      store.appPreferences[chat.computerId]?.providerBinaries,
      s.provider,
      s.accountId ?? 'default',
      undefined,
      (text, values) => translate(store.language, text, values),
    )
  // What "Switch back" returns to: the earlier login when only the login changed, else the earlier model.
  const backTo = (s: import('@ramu/shared/types').AgentSettings) =>
    item.settings &&
    s.provider === item.settings.provider &&
    label(s) === label(item.settings) &&
    (s.accountId ?? 'default') !== (item.settings.accountId ?? 'default')
      ? loginName(s)
      : label(s)
  let title = item.goalNote ? (strings.goalNotes[item.goalNote] ?? item.title) : item.title
  if (!item.goalNote) title = item.titleCopy ? say(item.titleCopy.text, item.titleCopy.values) : say(item.title)
  // As on the desktop, each model carries its provider's mark: "[Claude] Opus Medium → [Codex] GPT-5.5 High".
  let change: ReactNode = null
  if (item.settings) {
    const next = item.settings,
      before = item.previous
    const model = (s: import('@ramu/shared/types').AgentSettings) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <ProviderIcon provider={s.provider} size={13} />
        <T size={font.caption} tone="muted">
          {label(s)}
        </T>
      </View>
    )
    const modelChanged = !!before && (before.provider !== next.provider || label(before) !== label(next))
    // The login is part of what runs the model: a switch between two logins of one model says which, by name.
    const accountChanged =
      !!before && before.provider === next.provider && (before.accountId ?? 'default') !== (next.accountId ?? 'default')
    const others = (
      before
        ? [
            ...([[say(ACCESS[before.access]), say(ACCESS[next.access])]] as const)
              .filter(([a, b]) => a !== b)
              .map(([a, b]) => `${a} → ${b}`),
            ...(accountChanged ? [`${loginName(before!)} → ${loginName(next)}`] : []),
          ]
        : [say(ACCESS[next.access])]
    ).join(' · ')
    change = (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {modelChanged ? (
          <>
            {model(before!)}
            <T size={font.caption} tone="muted">
              →
            </T>
          </>
        ) : null}
        {model(next)}
        {others ? (
          <T size={font.caption} tone="muted">
            · {others}
          </T>
        ) : null}
      </View>
    )
  }
  return (
    <View
      accessible
      accessibilityRole="text"
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, marginVertical: space.s }}
    >
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.lineStrong }} />
      <View style={{ maxWidth: '78%', alignItems: 'center', gap: 2 }}>
        {change ?? (
          <T size={font.caption} tone={item.failed ? 'bad' : 'muted'} style={{ textAlign: 'center' }}>
            {title}
          </T>
        )}
        {item.detail ? (
          <T size={font.caption} tone="placeholder" style={{ textAlign: 'center' }}>
            {item.detailIsCopy ? say(item.detail) : item.detail}
          </T>
        ) : null}
        {item.pending ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={say('Cancel the model change')}
            onPress={() => {
              tap()
              cancelPending()
            }}
            hitSlop={8}
            style={{ marginTop: 2 }}
          >
            <T size={font.caption} weight="600" tone="accent">
              {item.previous ? say('Cancel · stay on {0}', { 0: label(item.previous) }) : say('Cancel')}
            </T>
          </Pressable>
        ) : null}
        {undo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={say('Switch back to the previous model and settings')}
            disabled={undoing}
            onPress={undo}
            hitSlop={8}
            style={{ marginTop: 2, opacity: undoing ? 0.5 : 1 }}
          >
            <T size={font.caption} weight="600" tone="accent">
              {undoing
                ? say('Switching back…')
                : item.previous
                  ? say('Switch back to {0}', { 0: backTo(item.previous) })
                  : say('Switch back to previous model')}
            </T>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.lineStrong }} />
    </View>
  )
}

/** "Worked for 12m 48s": a finished turn's routine steps, collapsed until tapped. */
function TurnSummary({ label, children }: { label: string; children: ReactNode }) {
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const toggled = useContext(RowToggle)
  return (
    <View style={{ gap: space.m }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          toggled()
          setOpen((o) => !o)
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingTop: 6,
          paddingBottom: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.line,
        }}
      >
        {/* A section heading over the steps, so its chevron stays beside the label as on the desktop; the row is the target. */}
        <T size={font.control} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {say(label)}
        </T>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        {/* Folded steps read as one list, as tool rows inside a group do. */}
        <View style={{ gap: space.xs }}>{children}</View>
      </Collapse>
    </View>
  )
}

function UserBubble({ text, attachments, chat }: { text: string; attachments?: Attachment[]; chat: Chat }) {
  const { c } = useTheme()
  const say = useSay()
  const toggled = useContext(RowToggle)
  const [expanded, setExpanded] = useState(false)
  const actions = useContext(ReferenceContext)
  const segments = composerDraft(text + ' ', useContext(ChatMentions)).segments
  // Quotes stand above the message as their own block, like the desktop's quoted reply; the rest flows as text with badges.
  const quotes = segments.filter(
    (part): part is import('@ramu/shared/chat/composerDraft').DraftChip => part.kind === 'quote',
  )
  const rest = segments.filter((part) => part.kind !== 'quote')
  const body = rest.map((part, index) =>
    part.kind === 'text' ? (
      (index === rest.length - 1 ? part.source.slice(0, -1) : part.source).replace(
        /^\n+/,
        quotes.length && index === 0 ? '' : '$&',
      )
    ) : part.kind === 'file' ? (
      <ReferenceBadge key={index} chip={draftChip(part)} onPress={() => actions.openFile(part.target ?? part.label)} />
    ) : (
      <ReferenceBadge key={index} chip={draftChip(part)} />
    ),
  )
  const hasText = rest.some((part) => part.kind !== 'text' || part.source.trim())
  // Markdown lays out blocks, so a message with inline badges stays one line of text and keeps them in place.
  // The native Markdown view draws file and skill references as links, so a message with them stays selectable too.
  const plain =
    hasText && (nativeMarkdown || rest.every((part) => part.kind === 'text'))
      ? rest
          .map((part) => part.source)
          .join('')
          .trim()
      : null
  // Code and tables scroll sideways, which needs a width to scroll within: a bubble that only fits its content gave
  // them none, so it came out shorter than its own content and was drawn over the reply below.
  const wide = plain !== null && /^\s*(```|~~~|\|.*\|)/m.test(plain)
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        ...(wide ? { width: '86%' } : { maxWidth: '86%' }),
        gap: space.s,
        alignItems: wide ? 'stretch' : 'flex-end',
      }}
    >
      {attachments?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
          {attachments.map((file) => (
            <AttachmentTile key={file.id} file={file} chat={chat} />
          ))}
        </View>
      ) : null}
      {quotes.length || hasText ? (
        <View
          style={{
            backgroundColor: c.bubble,
            borderRadius: radius.l - 2,
            borderBottomRightRadius: radius.xs,
            paddingHorizontal: space.m + 2,
            paddingVertical: space.s + 2,
            gap: space.s,
          }}
        >
          {quotes.map((part, index) => (
            <View key={index} style={{ borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingLeft: space.s }}>
              <T size={font.control} tone="muted" numberOfLines={6}>
                {part.label}
              </T>
            </View>
          ))}
          {plain !== null ? (
            <LongMessage
              text={plain}
              expanded={expanded}
              label={expanded ? say('Show less') : say('Show more')}
              accent={c.accent}
              onToggle={() => {
                tap()
                toggled()
                setExpanded((open) => !open)
              }}
            />
          ) : hasText ? (
            <T tone="text" style={{ lineHeight: 21 }}>
              {body}
            </T>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** A sent message, or only its beginning with a control to show the rest when it is long. */
export function LongMessage({
  text,
  expanded,
  label,
  accent,
  onToggle,
}: {
  text: string
  expanded: boolean
  label: string
  accent: string
  onToggle: () => void
}) {
  const preview = useMemo(() => messagePreview(text), [text])
  const marks = useContext(TextMarkContext)
  // Words a find or quote led to past the preview show the whole message, or they would be highlighted out of sight.
  const reveal = useMemo(
    () => Boolean(preview && marks?.length && markSource(preview, marks) === null),
    [preview, marks],
  )
  if (!preview) return <Markdown text={text} />
  return (
    <>
      <Markdown text={expanded || reveal ? text : preview} />
      {reveal && !expanded ? null : (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} hitSlop={8} onPress={onToggle}>
          <T size={font.control} weight="500" style={{ color: accent }}>
            {label}
          </T>
        </Pressable>
      )}
    </>
  )
}

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>

/** What a tool says: Ramu's own tools what they did (Saved memory “…”), file tools verb and file name, the rest as sent. */
function toolWords(item: ToolItem, language: Language, running: boolean): { verb: string; subject: string } {
  if (item.ramu)
    return { verb: translate(language, running ? item.ramu.running : item.ramu.done), subject: item.ramu.subject ?? '' }
  // A command's terminal icon and its own words already say what runs; the tool's name ("Bash") adds nothing.
  if (item.tool === 'execute' && !item.file && item.subject) return { verb: '', subject: item.subject }
  return { verb: item.file ? translate(language, toolVerb(item.verb, running)) : item.verb, subject: item.subject }
}

/** `live`: the newest group of a running turn, so its headline names the latest call, as the desktop's does. */
function ToolGroup({ item, live }: { item: Extract<TranscriptItem, { kind: 'tools' }>; live: boolean }) {
  const { c } = useTheme()
  const { language } = useStore()
  const say = useSay()
  const [open, setOpen] = useState(false)
  const toggled = useContext(RowToggle)
  const { current, running, failed } = toolActivity(item.tools, (tool) =>
    tool.status === 'in_progress' ? 'running' : tool.status === 'failed' ? 'failed' : 'done',
  )
  const counts = new Map<string, number>()
  for (const tool of item.tools) {
    const verb = toolWords(tool, language, false).verb || translate(language, 'Commands')
    counts.set(verb, (counts.get(verb) ?? 0) + 1)
  }
  const shown = live && !running ? (item.tools.at(-1) ?? current) : current
  const words = shown ? toolWords(shown, language, shown.status === 'in_progress') : null
  const headline =
    live || running || failed
      ? `${words?.verb ?? ''} ${words?.subject ?? ''}`.trim()
      : [...counts].map(([verb, count]) => `${verb}${count > 1 ? ` ×${count}` : ''}`).join(' · ')
  // A group of Ramu's own tools wears its mark, as each of its rows does.
  const ramuGroup = item.tools.every((tool) => tool.ramu)
  const Icon = shown ? toolIcons[shown.tool] : Wrench
  // While working, only the words shimmer; the icon stays still, as on the desktop.
  const tint = failed ? c.bad : c.muted
  // Tools already here when the group appeared stay still; ones that arrive later fade in.
  const initial = useRef(new Set(item.tools.map((tool) => tool.id))).current
  return (
    <View style={{ gap: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          toggled()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}
      >
        {ramuGroup || shown?.ramu ? <RamuGlyph size={14} color={tint} /> : <Icon size={14} color={tint} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* The headline follows the current tool; each change fades instead of jumping. */}
          <Arrive animate={false} identity={headline}>
            <ActivityText active={running > 0 || live}>{headline}</ActivityText>
          </Arrive>
        </View>
        {failed > 0 ? (
          <T size={font.caption} tone="bad">
            {say('Failed')} · {failed}
          </T>
        ) : null}
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        <View style={{ gap: space.xs }}>
          {item.entries.map((entry, index) =>
            entry.kind === 'thinking' ? (
              <ThinkingRow key={entry.id} text={entry.text} live={live && index === item.entries.length - 1} />
            ) : (
              <Arrive key={entry.id} animate={!initial.has(entry.id)}>
                <ToolRow item={entry} />
              </Arrive>
            ),
          )}
        </View>
      </Collapse>
    </View>
  )
}

function PlanCard({ item }: { item: Extract<TranscriptItem, { kind: 'plan' }> }) {
  const { c } = useTheme()
  const { language } = useStore()
  const [open, setOpen] = useState(true)
  const toggled = useContext(RowToggle)
  const completed = item.entries.filter((entry) => entry.status === 'completed').length
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          toggled()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}
      >
        <T weight="600" size={font.control} style={{ flex: 1 }}>
          {translate(language, 'Plan')} · {completed}/{item.entries.length}
        </T>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        <View style={{ gap: space.s }}>
          {item.entries.map((entry, index) => (
            <View key={index} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
              <Breathe active={entry.status === 'in_progress'}>
                {entry.status === 'completed' ? (
                  <Check size={14} color={c.ok} />
                ) : (
                  <View
                    style={{
                      width: 14,
                      height: 14,
                      borderWidth: 1,
                      borderColor: entry.status === 'in_progress' ? c.accent : c.lineStrong,
                      borderRadius: 7,
                    }}
                  />
                )}
              </Breathe>
              <T
                size={font.control}
                tone={entry.status === 'completed' ? 'muted' : 'soft'}
                style={{ flex: 1 }}
                accessibilityLabel={`${entry.content}, ${translate(language, entry.status === 'completed' ? 'Completed' : entry.status === 'in_progress' ? 'Running' : 'Pending')}`}
              >
                {entry.content}
              </T>
            </View>
          ))}
        </View>
      </Collapse>
    </View>
  )
}

function ToolRow({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  const say = useSay()
  const { c } = useTheme()
  const { language: storeLanguage } = useStore()
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const toggled = useContext(RowToggle)
  const references = useContext(ReferenceContext)
  // Reads and edits name a file; tapping it opens that file like the desktop's tool rows do.
  const filePath =
    item.file?.path ??
    (item.tool === 'read' || item.tool === 'edit'
      ? item.subject.match(/[\w@~./-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?/)?.[0]
      : undefined)
  const diffs = item.diffs ?? []
  const openable = Boolean(item.detail || item.input || diffs.length || item.file || item.ramu?.facts.length)
  const I = toolIcons[item.tool]
  // A log is cropped to a few lines inline; the whole thing opens in a sheet (a bottom sheet on iOS and Android alike).
  const PREVIEW_LINES = 6
  const lines = item.detail ? item.detail.split('\n').length : 0
  const long = Boolean(item.detail) && (lines > PREVIEW_LINES || item.detail!.length > 400)
  const running = item.status === 'in_progress'
  const failed = item.status === 'failed'
  const words = toolWords(item, storeLanguage, running)
  const title = `${words.verb} ${words.subject}`.trim()
  const facts = item.ramu?.facts ?? []
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: !openable }}
        disabled={!openable}
        onPress={() => {
          tap()
          toggled()
          setOpen((o) => !o)
        }}
        // Compact like the rows around it; the full-width row and the slop keep it easy to hit.
        hitSlop={{ top: 4, bottom: 4 }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 4 }}
      >
        {item.ramu ? (
          <RamuGlyph size={14} color={failed ? c.bad : c.muted} />
        ) : (
          <I size={14} color={failed ? c.bad : c.muted} strokeWidth={1.8} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <ActivityText active={running}>{title}</ActivityText>
        </View>
        {item.file?.added || item.file?.removed ? (
          <T size={font.caption} mono>
            {item.file.added ? <T size={font.caption} mono tone="ok">{`+${item.file.added}`}</T> : null}
            {item.file.added && item.file.removed ? ' ' : null}
            {item.file.removed ? <T size={font.caption} mono tone="bad">{`−${item.file.removed}`}</T> : null}
          </T>
        ) : null}
        {failed ? (
          <T size={font.caption} tone="bad">
            {say('Failed')}
          </T>
        ) : null}
        {openable ? <Disclosure open={open} color={c.muted} /> : null}
      </Pressable>
      <Collapse open={open}>
        {/* Opened, a file tool shows where the file lives and opens it; an edit shows its diff instead of raw input. */}
        {filePath ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${translate(storeLanguage, 'Open file')} ${filePath}`}
            onPress={() => {
              tap()
              references.openFile(filePath)
            }}
            hitSlop={6}
            style={{ marginTop: 2, flexDirection: 'row', gap: space.s, alignItems: 'center' }}
          >
            <T size={font.caption} mono tone="muted" numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 1 }}>
              {filePath}
            </T>
            <T size={font.caption} weight="600" tone="accent">
              {translate(storeLanguage, 'Open file')}
            </T>
          </Pressable>
        ) : null}
        {facts.length ? (
          <View style={{ marginTop: 4, gap: 4 }}>
            {facts.map((fact) => (
              <View key={fact.label} style={{ flexDirection: 'row', gap: space.m }}>
                <T size={font.caption} tone="muted" style={{ width: 64 }}>
                  {translate(storeLanguage, fact.label)}
                </T>
                <T size={font.caption} tone="soft" style={{ flex: 1 }} numberOfLines={4}>
                  {fact.value}
                </T>
              </View>
            ))}
          </View>
        ) : null}
        {diffs.map((diff, index) => (
          <View key={index} style={{ marginTop: 4 }}>
            <DiffLines file={changedFile(diff.path, '', diff.oldText ?? '', diff.newText)} />
          </View>
        ))}
        {(!diffs.length && !facts.length) || failed ? (
          <View
            style={{
              marginTop: 4,
              padding: space.s + 2,
              backgroundColor: c.code,
              borderRadius: radius.s,
            }}
          >
            {item.input ? (
              <View style={{ gap: space.xs, marginBottom: item.detail ? space.s : 0 }}>
                <T size={font.caption} weight="600" tone="muted">
                  {say('Input')}
                </T>
                <T size={font.caption} mono copyable={item.input}>
                  {item.input}
                </T>
              </View>
            ) : null}
            <T size={font.caption} weight="600" tone="muted">
              {say('Output')}
            </T>
            <T
              size={font.caption}
              mono
              tone={failed ? 'bad' : 'soft'}
              numberOfLines={PREVIEW_LINES}
              ellipsizeMode="tail"
            >
              {item.detail || (running ? say('Running…') : say('No output'))}
            </T>
            {long ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={say('Show full log')}
                onPress={() => {
                  tap()
                  setFull(true)
                }}
                hitSlop={8}
                style={{ alignSelf: 'flex-start', paddingTop: space.s }}
              >
                <T size={font.caption} weight="600" tone="accent">
                  {say('Show full log')}
                </T>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Collapse>
      {item.detail ? (
        <Sheet open={full} onClose={() => setFull(false)} title={title.trim()}>
          <Card style={{ marginHorizontal: space.l, padding: space.m }}>
            <T
              size={font.caption}
              mono
              copyable={item.detail}
              tone={failed ? 'bad' : 'soft'}
              style={{ lineHeight: 17 }}
            >
              {item.detail}
            </T>
          </Card>
        </Sheet>
      ) : null}
    </View>
  )
}

function AgentsGroup({ item, chat }: { item: Extract<TranscriptItem, { kind: 'agents' }>; chat: Chat }) {
  const onToggle = useContext(RowToggle)
  return <Helpers item={item} chat={chat} onToggle={onToggle} />
}

function Option({
  label,
  description,
  selected,
  multi,
  onPress,
}: {
  label: string
  description?: string
  selected: boolean
  multi: boolean
  onPress?: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled: !onPress }}
      disabled={!onPress}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.m,
        padding: space.m,
        borderRadius: radius.s + 2,
        backgroundColor: selected ? c.accentWash : pressed ? c.pressed : c.fill,
      })}
    >
      <View
        style={{
          width: 18,
          height: 18,
          marginTop: 1,
          borderRadius: multi ? 5 : 9,
          borderWidth: 1.5,
          borderColor: selected ? c.primary : c.lineStrong,
          backgroundColor: selected ? c.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Check size={11} color={c.primaryInk} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={font.body - 1} weight="500">
          {label}
        </T>
        {description ? (
          <T size={font.caption + 1} tone="muted" style={{ lineHeight: 18 }}>
            {description}
          </T>
        ) : null}
      </View>
    </Pressable>
  )
}

function QuestionHistory({ item }: { item: Extract<TranscriptItem, { kind: 'question' }> }) {
  const { c } = useTheme()
  const { language } = useStore()
  const t = (text: string) => translate(language, text)
  const outcome =
    item.outcome === 'dismissed'
      ? 'Dismissed'
      : item.outcome === 'obsolete'
        ? 'No longer needed'
        : item.outcome === 'cancelled'
          ? 'Cancelled'
          : 'Answered'
  return (
    <Card style={{ padding: space.m, gap: space.m, backgroundColor: c.fill }}>
      <T size={font.control} tone="muted">
        {t('Asked a question')} · {t(outcome)}
        {item.reason ? `: ${item.reason}` : ''}
      </T>
      {item.questions.map((question) => (
        <QuestionHistoryEntry
          key={question.id ?? question.question}
          question={question}
          answer={item.answers?.[question.id ?? question.question]}
        />
      ))}
    </Card>
  )
}

function QuestionHistoryEntry({
  question,
  answer,
}: {
  question: import('@ramu/shared/types').AgentQuestion
  answer?: string
}) {
  const { c } = useTheme()
  const { language } = useStore()
  const [open, setOpen] = useState(false)
  const toggled = useContext(RowToggle)
  const selected = new Set(answer ? (question.multiSelect ? answer.split(', ') : [answer]) : [])
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        disabled={!question.options.length}
        accessibilityRole={question.options.length ? 'button' : 'text'}
        accessibilityState={question.options.length ? { expanded: open } : undefined}
        onPress={() => {
          tap()
          toggled()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}
      >
        <T size={font.control} tone="soft" style={{ flex: 1 }}>
          {question.question}
        </T>
        {question.options.length ? <Disclosure open={open} color={c.muted} /> : null}
      </Pressable>
      <Collapse open={open}>
        <View style={{ gap: space.s }}>
          {question.options.map((option) => (
            <Option
              key={option.label}
              label={option.label}
              description={option.description}
              selected={selected.has(option.label)}
              multi={question.multiSelect}
            />
          ))}
        </View>
      </Collapse>
      {answer ? (
        <View style={{ gap: space.xs, backgroundColor: c.raised, padding: space.m, borderRadius: radius.s }}>
          <T size={font.caption} tone="muted">
            {translate(language, 'Answer')}
          </T>
          <T size={font.control} weight="600" copyable={answer}>
            {answer}
          </T>
        </View>
      ) : (
        <T size={font.control} tone="muted">
          {translate(language, 'No answer')}
        </T>
      )}
    </View>
  )
}

function QuestionCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'question' }>; chatId: string }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const { answer } = store
  const chat = store.chats.find((c) => c.id === chatId)
  const draftKey = `${chat?.computerId}:input:${chat?.sessionId}:${item.id}`
  let draft: { picked?: Record<string, string[]>; other?: Record<string, string> } = {}
  try {
    draft = JSON.parse(store.drafts[draftKey] ?? '{}')
  } catch {}
  const [picked, setPicked] = useState<Record<string, string[]>>(draft.picked ?? {})
  const [other, setOther] = useState<Record<string, string>>(draft.other ?? {})
  useEffect(() => {
    store.setDraft(draftKey, JSON.stringify({ picked, other }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [draftKey, picked, other] by design; the values it reads beyond these are current as of that run
  }, [draftKey, picked, other])
  if (item.answers) return <QuestionHistory item={item} />
  const ready = item.questions.every(
    (q) => (picked[q.id ?? q.question]?.length ?? 0) > 0 || other[q.id ?? q.question]?.trim(),
  )
  return (
    <Card style={{ padding: space.m, gap: space.m, backgroundColor: c.raised2 }}>
      {item.submitted ? (
        <T tone="muted" size={font.caption}>
          Already submitted: {Object.values(item.submitted).join(' · ')}
        </T>
      ) : null}
      {item.questions.map((q) => (
        <View key={q.id ?? q.question} style={{ gap: space.s }}>
          <T size={font.caption} weight="600" tone="warn" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {q.header}
          </T>
          <T size={font.body} weight="600" style={{ lineHeight: 21, marginBottom: 2 }}>
            {q.question}
          </T>
          {q.options.map((o) => {
            const sel = picked[q.id ?? q.question]?.includes(o.label) ?? false
            return (
              <Option
                key={o.label}
                label={o.label}
                description={o.description}
                multi={q.multiSelect}
                selected={sel}
                onPress={() => {
                  setOther((old) => ({ ...old, [q.id ?? q.question]: '' }))
                  setPicked((p) => {
                    const cur = p[q.id ?? q.question] ?? []
                    const next = q.multiSelect
                      ? sel
                        ? cur.filter((x) => x !== o.label)
                        : [...cur, o.label]
                      : sel
                        ? []
                        : [o.label]
                    return { ...p, [q.id ?? q.question]: next }
                  })
                }}
              />
            )
          })}
          <TextInput
            placeholder={say('Other answer…')}
            placeholderTextColor={c.placeholder}
            value={other[q.id ?? q.question] ?? ''}
            accessibilityLabel={q.question}
            onChangeText={(v) => {
              setPicked((old) => ({ ...old, [q.id ?? q.question]: [] }))
              setOther((o) => ({ ...o, [q.id ?? q.question]: v }))
            }}
            style={{
              color: c.text,
              fontSize: font.body - 1,
              padding: space.m,
              borderRadius: radius.s + 2,
              backgroundColor: c.fill,
            }}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
        {item.responseMode === 'message' ? (
          <Button kind="ghost" title={say('Dismiss')} onPress={() => answer(chatId, item.id, { _: 'Dismissed' })} />
        ) : null}
        <Button
          title={say('Submit')}
          disabled={!ready}
          onPress={() =>
            answer(
              chatId,
              item.id,
              Object.fromEntries(
                item.questions.map((q) => [
                  q.id ?? q.question,
                  [...(picked[q.id ?? q.question] ?? []), other[q.id ?? q.question]?.trim()].filter(Boolean).join(', '),
                ]),
              ),
            )
          }
        />
      </View>
    </Card>
  )
}

function PermissionCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'permission' }>; chatId: string }) {
  const say = useSay()
  const { c } = useTheme()
  const { decide, forgetApproval } = useStore()
  const [rule, setRule] = useState('exact')
  if (item.decision) {
    const allowed = item.decision === 'allow'
    return (
      <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
        {allowed ? <Check size={14} color={c.ok} /> : <X size={14} color={c.bad} />}
        <T size={font.control} tone="muted" mono numberOfLines={1} style={{ flex: 1 }}>
          {item.saved === 'project'
            ? say('Allowed for this project')
            : item.saved === 'user'
              ? say('Allowed for this user')
              : say(allowed ? 'Allowed' : 'Denied')}{' '}
          · {item.command}
        </T>
        {item.saved ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              tap()
              forgetApproval(chatId, item.id, item.saved!)
            }}
          >
            <T size={font.caption} tone="accent">
              {say('Forget')}
            </T>
          </Pressable>
        ) : null}
      </View>
    )
  }
  const pattern = rule === 'exact' ? undefined : rule
  return (
    <Card style={{ padding: space.m, gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <ShieldAlert size={16} color={c.warn} strokeWidth={1.8} />
        <T size={font.body} weight="600">
          {say(item.title)}
        </T>
      </View>
      <View style={{ backgroundColor: c.code, borderRadius: radius.s, padding: space.m }}>
        <T size={font.caption + 1} mono tone="soft">
          {item.command}
        </T>
      </View>
      {item.reviewRule ? (
        <T size={font.caption} tone="muted">
          {say('Always ask')}: {item.reviewRule}
        </T>
      ) : null}
      {/* As on the desktop: the rule a saved approval covers, then every choice at once, Allow once first. */}
      {item.rememberable && item.patterns?.length ? (
        <View style={{ gap: space.s }}>
          <T size={font.caption} tone="muted">
            {say('Don’t ask again for')}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {['exact', ...item.patterns].map((value) => (
              <Chip
                key={value}
                small
                label={value === 'exact' ? say('This exact request') : value}
                selected={rule === value}
                maxLabelWidth={220}
                onPress={() => setRule(value)}
              />
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ gap: space.s }}>
        <Button title={say('Allow once')} onPress={() => decide(chatId, item.id, 'allow')} />
        {item.rememberable?.project ? (
          <Button
            kind="secondary"
            title={say('Allow for this project')}
            onPress={() => decide(chatId, item.id, 'allow', 'project', pattern)}
          />
        ) : null}
        {item.rememberable ? (
          <Button
            kind="secondary"
            title={say('Allow for this user')}
            onPress={() => decide(chatId, item.id, 'allow', 'user', pattern)}
          />
        ) : null}
        {item.productionDeploy ? (
          <Button
            kind="secondary"
            title={say('Allow production deploys in this thread')}
            onPress={() => decide(chatId, item.id, 'allow', 'thread')}
          />
        ) : null}
        {item.always ? (
          <Button
            kind="secondary"
            title={say('Always allow')}
            onPress={() => decide(chatId, item.id, 'allow', 'user')}
          />
        ) : null}
        <Button kind="secondary" title={say('Deny')} onPress={() => decide(chatId, item.id, 'deny')} />
      </View>
      <T size={font.caption} tone="muted">
        {say(
          item.rememberable
            ? 'Saved approvals apply to the selected rule. Allow once applies only to this request.'
            : item.always
              ? 'Always allow lets this tool run without asking. Change it back in Customize → MCP servers.'
              : item.productionDeploy
                ? 'Allow in this thread lasts until the thread ends or Ramu restarts; other threads still ask.'
                : 'Applies to this request only.',
        )}
      </T>
    </Card>
  )
}

function ChangesCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'changes' }>; chatId: string }) {
  const { c } = useTheme()
  const router = useRouter()
  const { language } = useStore()
  const [expanded, setExpanded] = useState(false)
  const toggled = useContext(RowToggle)
  const say = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const open = (fileId?: string) => {
    tap()
    router.push({
      pathname: '/chat/[id]/changes',
      params: { id: chatId, review: item.reviewId, ...(fileId ? { file: fileId } : {}) },
    })
  }
  const single = item.files.length === 1
  const name = (path: string) => path.split('/').pop() ?? path
  const visible = expanded ? item.files : item.files.slice(0, 3)
  const stats = (added: number, removed: number) => (
    <T size={font.caption} mono>
      <T size={font.caption} mono tone="ok">{`+${added}`}</T> <T size={font.caption} mono tone="bad">{`−${removed}`}</T>
    </T>
  )
  // The desktop's end-of-turn card: what changed, its line totals and View changes; several files are listed below.
  return (
    <Card style={{ marginVertical: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={say('View changes')}
        onPress={() => open()}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s + 2,
          paddingVertical: space.s,
          paddingHorizontal: space.m,
          backgroundColor: pressed ? c.pressed : undefined,
        })}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.s,
            backgroundColor: c.fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {single ? (
            <FileIcon path={item.files[0]!.path} size={15} />
          ) : (
            <FileDiff size={15} color={c.muted} strokeWidth={1.7} />
          )}
        </View>
        <T size={font.control} weight="500" numberOfLines={1} style={{ flexShrink: 1 }}>
          {single
            ? say('Edited {0}', { '0': name(item.files[0]!.path) })
            : say('Edited {0} files', { '0': item.files.length })}
        </T>
        {item.undone ? (
          <T size={font.caption} tone="muted">
            {say('Changes undone')}
          </T>
        ) : (
          stats(item.additions, item.deletions)
        )}
        <View style={{ flex: 1 }} />
        <T size={font.caption} weight="600" tone="accent">
          {say('View')}
        </T>
        <ChevronRight size={14} color={c.accent} />
      </Pressable>
      {single
        ? null
        : visible.map((file) => (
            <Pressable
              key={file.id}
              accessibilityRole="button"
              accessibilityLabel={file.path}
              onPress={() => open(file.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s,
                minHeight: 32,
                paddingHorizontal: space.m,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: c.line,
                backgroundColor: pressed ? c.pressed : undefined,
              })}
            >
              <FileIcon path={file.path} size={14} />
              <T size={font.caption} numberOfLines={1} ellipsizeMode="head" style={{ flex: 1 }}>
                {file.path}
              </T>
              {stats(file.additions, file.deletions)}
            </Pressable>
          ))}
      {!single && item.files.length > 3 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            tap()
            toggled()
            setExpanded((value) => !value)
          }}
          style={{
            minHeight: 32,
            justifyContent: 'center',
            paddingHorizontal: space.m,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.line,
          }}
        >
          <T size={font.control} tone="muted">
            {expanded ? say('Show fewer files') : say('Show {0} more files', { '0': item.files.length - 3 })}
          </T>
        </Pressable>
      ) : null}
    </Card>
  )
}

/**
 * A turning point in a goal's life (set, paused, failed check…), left where it happened as the same quiet activity row
 * as a finished goal, as on the desktop; tapping it shows the goal and what happened.
 */
function GoalNote({ item }: { item: Extract<TranscriptItem, { kind: 'note' }> }) {
  const { c } = useTheme()
  const strings = useT()
  const [open, setOpen] = useState(false)
  const toggled = useContext(RowToggle)
  const type = item.goalNote!
  const warn = type === 'blocked' || type === 'stalled' || type === 'verify-failed' || type === 'turn-limit'
  const Icon = warn
    ? CircleAlert
    : type === 'paused'
      ? CirclePause
      : type === 'resumed'
        ? Play
        : type === 'cleared'
          ? X
          : Target
  const color = warn ? c.warn : type === 'paused' || type === 'cleared' ? c.muted : c.accent
  const title = strings.goalNotes[type] ?? item.title
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.objective ? `${title}: ${item.objective}` : title}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          toggled()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}
      >
        <Icon size={14} color={color} strokeWidth={1.8} />
        <T size={font.control} tone="soft">
          {title}
        </T>
        <T size={font.control} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {item.objective ?? ''}
        </T>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        <View style={{ gap: space.s, paddingLeft: 14 + space.s }}>
          {item.objective ? <T>{item.objective}</T> : null}
          {item.detail ? (
            <T size={font.caption} tone={warn ? 'warn' : 'muted'} copyable={item.detail}>
              {item.detail}
            </T>
          ) : null}
        </View>
      </Collapse>
    </View>
  )
}

function GoalDone({ item }: { item: Extract<TranscriptItem, { kind: 'goal' }> }) {
  const { c } = useTheme()
  const strings = useT()
  const [open, setOpen] = useState(false)
  const toggled = useContext(RowToggle)
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          toggled()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}
      >
        <Flag size={14} color={c.ok} strokeWidth={1.8} />
        <T size={font.control} tone="muted" style={{ flex: 1 }}>
          {fill(strings.goalReached, item.turns, item.objective)}
        </T>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        <View style={{ gap: space.s, paddingLeft: 14 + space.s }}>
          <T>{item.objective}</T>
          {item.detail ? (
            <T size={font.caption} tone="muted" copyable={item.detail}>
              {item.detail}
            </T>
          ) : null}
        </View>
      </Collapse>
    </View>
  )
}

function ElicitationCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'elicitation' }>; chatId: string }) {
  const say = useSay()
  const { elicitation } = useStore()
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.request.fields.map((f) => [f.id, f.defaultValue ?? ''])),
  )
  if (item.outcome)
    return (
      <T tone="muted">
        {item.request.message} · {item.outcome}
      </T>
    )
  return (
    <Card style={{ padding: space.m, gap: space.m }}>
      <T weight="600">{item.request.serverName}</T>
      <T>{item.request.message}</T>
      {item.request.mode === 'url' && item.request.url ? (
        <Button
          title={say('Open request')}
          onPress={() => {
            const url = item.request.url!
            if (/^https?:\/\//i.test(url)) void Linking.openURL(url)
          }}
        />
      ) : null}
      {item.request.fields.map((f) => (
        <View key={f.id} style={{ gap: space.s }}>
          <T>
            {f.label}
            {f.required ? ' *' : ''}
          </T>
          {f.description ? (
            <T size={font.caption} tone="muted">
              {f.description}
            </T>
          ) : null}
          <ElicitationInput
            field={f}
            value={answers[f.id] ?? ''}
            onChange={(v) => setAnswers((old) => ({ ...old, [f.id]: v }))}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button kind="secondary" title={say('Decline')} onPress={() => elicitation(chatId, item.id, 'decline', {})} />
        <Button
          title={say('Submit')}
          disabled={item.request.fields.some((f) => f.required && !elicitationAnswered(f, answers[f.id] ?? ''))}
          onPress={() => elicitation(chatId, item.id, 'accept', answers)}
        />
      </View>
    </Card>
  )
}

/** One masked secret. Keeping it as an environment variable is offered only on the host itself. */
function SecretCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'secret' }>; chatId: string }) {
  const say = useSay()
  const { c } = useTheme()
  const { answerSecret } = useStore()
  const [secret, setSecret] = useState('')
  if (item.outcome)
    return (
      <T tone="muted">
        {item.request.label} ·{' '}
        {item.outcome === 'saved'
          ? say('Saved for this thread')
          : item.outcome === 'saved-env'
            ? say('Saved and kept as {0}', { 0: item.request.envName ?? '' })
            : item.outcome === 'declined'
              ? say('Declined')
              : item.outcome === 'timed_out'
                ? say('Timed out')
                : say('Cancelled')}
      </T>
    )
  return (
    <Card style={{ padding: space.m, gap: space.m }}>
      <T weight="600">{item.request.label}</T>
      <T>{item.request.reason}</T>
      <TextInput
        accessibilityLabel={item.request.label}
        placeholder={item.request.placeholder}
        placeholderTextColor={c.muted}
        value={secret}
        maxLength={64 * 1024}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        onChangeText={setSecret}
        style={{ color: c.text, backgroundColor: c.fill, padding: space.m, borderRadius: radius.m }}
      />
      <T size={font.caption} tone="muted">
        {say('The agent gets a private file with the value, never the value itself. The file is deleted after a day.')}
      </T>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          kind="secondary"
          title={say('Decline')}
          onPress={() => answerSecret(chatId, item.id, { type: 'decline' })}
        />
        <Button
          title={say('Save')}
          disabled={!secret.trim()}
          onPress={() => {
            answerSecret(chatId, item.id, { type: 'save', secret })
            setSecret('')
          }}
        />
      </View>
    </Card>
  )
}

/** A required answer is present: a non-empty text or number, a yes/no, or at least one choice of a list. */
export function elicitationAnswered(field: ElicitationField, value: string) {
  if (field.type === 'array') return selectedChoices(value).length > 0
  return value.trim().length > 0
}

const selectedChoices = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/**
 * One form field as the matching control, encoded as the desktop encodes it: a choice's value, `true`/`false`, digits
 * on a number keyboard, or a JSON list for several choices.
 */
function ElicitationInput({
  field,
  value,
  onChange,
}: {
  field: ElicitationField
  value: string
  onChange(value: string): void
}) {
  const say = useSay()
  const { c } = useTheme()
  const choices =
    field.type === 'boolean'
      ? [
          { value: 'true', label: say('Yes') },
          { value: 'false', label: say('No') },
        ]
      : field.options
  if (choices.length) {
    const selected = field.type === 'array' ? selectedChoices(value) : []
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {choices.map((choice) => {
          const on = field.type === 'array' ? selected.includes(choice.value) : value === choice.value
          return (
            <Chip
              key={choice.value}
              label={choice.label}
              selected={on}
              onPress={() =>
                onChange(
                  field.type === 'array'
                    ? JSON.stringify(
                        on ? selected.filter((entry) => entry !== choice.value) : [...selected, choice.value],
                      )
                    : on && !field.required
                      ? ''
                      : choice.value,
                )
              }
            />
          )
        })}
      </View>
    )
  }
  const numeric = field.type === 'number' || field.type === 'integer'
  return (
    <TextInput
      accessibilityLabel={field.label}
      value={value}
      maxLength={10000}
      keyboardType={field.type === 'integer' ? 'number-pad' : field.type === 'number' ? 'decimal-pad' : 'default'}
      autoCapitalize={numeric ? 'none' : 'sentences'}
      onChangeText={(next) => onChange(field.type === 'integer' ? next.replace(/[^\d-]/g, '') : next)}
      style={{ color: c.text, backgroundColor: c.fill, padding: space.m, borderRadius: radius.m }}
    />
  )
}

function InteractiveBlock({
  reference,
  previous,
  update,
  chat,
}: {
  reference: import('@ramu/shared/interactive').InteractiveReference
  previous?: import('@ramu/shared/interactive').InteractiveReference
  update?: import('@ramu/shared/interactiveRevisions').InteractiveUpdate
  chat: Chat
}) {
  const menu = useContext(MessageMenu)
  return (
    <InteractiveContent
      key={`${reference.id}:${reference.version}`}
      reference={reference}
      previous={previous}
      update={update}
      chat={chat}
      onAsk={(text) => menu?.quote(text)}
    />
  )
}

function InteractiveVersionRow({
  reference,
  replacedBy,
  chat,
}: {
  reference: import('@ramu/shared/interactive').InteractiveReference
  replacedBy: { itemId: string; version: number; changes?: string }
  chat: Chat
}) {
  const menu = useContext(MessageMenu)
  return (
    <InteractiveOlderVersion
      reference={reference}
      replacedBy={replacedBy}
      chat={chat}
      readOnly={menu?.readOnly}
      onLatest={() => menu?.goTo?.(replacedBy.itemId)}
    />
  )
}

/**
 * Reasoning the provider shared, as the desktop's ThinkingRow: closed, "Thinking" (shimmering while it streams) or
 * "Thought" is followed by the thought on one line ending in an ellipsis, its newest paragraph while it streams; a tap
 * opens the whole thought.
 */
function ThinkingRow({ text, live }: { text: string; live: boolean }) {
  const { c } = useTheme()
  const say = useSay()
  const [open, setOpen] = useState(false)
  const toggled = useContext(RowToggle)
  const line = useMemo(() => thoughtLine(text, live), [text, live])
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          toggled()
          setOpen((value) => !value)
        }}
        hitSlop={{ top: 4, bottom: 4 }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 4 }}
      >
        <Brain size={14} color={c.muted} />
        {live ? (
          <Shimmer size={font.control}>{say('Thinking')}</Shimmer>
        ) : (
          <T size={font.control} tone="muted">
            {say('Thought')}
          </T>
        )}
        <T size={font.control} tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {open ? '' : line}
        </T>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        <View style={{ paddingTop: space.xs }}>
          <T size={font.caption} tone="muted" style={{ lineHeight: 18 }}>
            {text}
          </T>
        </View>
      </Collapse>
    </View>
  )
}
