import { MEDIA_SERVICE_NAMES } from '@ramu/shared/types/media'
import { ImagePreview } from './ImagePreview'
import { MessageSelectionMenuContext, TextMarkContext, nativeMarkdown } from './NativeMarkdown'
import { markSource } from '../runtime/textMark'
import { ContinuedCard } from './ContinueOnHost'
import { CheckoutClashCard, CommandWaitNote } from './CheckoutClashCard'
import { toolActivity } from '@ramu/shared/chat/toolActivity'
import { summarizeTools, toolRowWords } from '@ramu/shared/chat/toolSummary'
import { attachmentPreview } from '../runtime/attachmentPreviews'
import { GOAL_NOTE_LABELS } from '@ramu/shared/chat/goalHistory'
import { NEW_THOUGHT, thoughtEnding, thoughtLine, thoughtTitle, tickThought } from '@ramu/shared/chat/thoughtLine'
import { FileIcon } from './FileIcon'
import { isModelFile, ModelTile } from './ModelViewer'
import { translate, type Language } from '@ramu/shared/i18n'
import { toolVerb } from '@ramu/shared/chat/toolStatus'
import { DiffLines } from './DiffLines'
import { changedFile } from '../runtime/diff'
import { Helpers, ReportCard } from './Helpers'
import { InteractiveContent, InteractiveOlderVersion } from './InteractiveContent'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  ActionSheetIOS,
  Alert,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { AgentQuestion, Attachment } from '@ramu/shared/types'
import { useFocusEffect, useRouter } from 'expo-router'
import { ABILITY_DONE, ABILITY_LABELS, isMediaAbility, type AbilityCall } from '@ramu/shared/providers/abilities'
import { providerName } from '@ramu/shared/providers/providers'
import {
  Check,
  Copy,
  FileCode2,
  FilePen,
  BellRing,
  GitFork,
  ChevronRight,
  FileDiff,
  CircleCheck,
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
  CircleX,
  AppWindow,
  FolderOpen,
  MessageCircleQuestion,
  Pencil,
  Minimize2,
  RotateCcw,
  OctagonX,
  CalendarClock,
  Send,
  MousePointerClick,
  MessageSquareReply,
  type LucideIcon,
} from 'lucide-react-native'
import { pickFolder } from '../runtime/folderPick'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { agentErrorView } from '@ramu/shared/chat/agentErrorView'
import { toolFailure } from '@ramu/shared/chat/toolFailure'
import { endedOnError, formatDuration } from '../runtime/turns'
import { limitWaitOf } from '../runtime/limitTray'
import { showError } from '../runtime/toast'
import { accountName } from '@ramu/shared/providers/providers'
import { providerNames, type Chat, type NoteIcon, type ToolKind, type TranscriptItem } from '../runtime/types'
import { useStore } from '../runtime/store'
import { Markdown, ReferenceBadge, ReferenceContext } from './Markdown'
import { draftChip } from '@ramu/shared/chat/referenceChip'
import { hasSentContext, sentContext, type SentReviewComment } from '@ramu/shared/chat/sentContext'
import { terminalAttachmentLabel } from '@ramu/shared/chat/terminalContext'
import { composerDraft, type DraftMention } from '@ramu/shared/chat/composerDraft'
import { useOpenFile } from '../runtime/openFile'
import { Button, Card, Chip, Sheet, SheetScrollView, T, tap, type Icon } from './ui'
import type { ElicitationField } from '@ramu/shared/types'
import { ActivityText, Arrive, Breathe, Collapse, Disclosure, Shimmer } from './Motion'
import { Glow } from './Glow'
import { InteractiveVisibility } from './InteractiveVisibility'
import { ProviderIcon } from './Logos'
import { ThemeProposal } from './ThemeProposal'
import { Option } from './ChoiceOption'
import { InlineUiCard } from './InlineUiCard'

const toolIcons: Record<ToolKind, Icon> = {
  read: FileCode2,
  edit: FilePen,
  search: Search,
  execute: SquareTerminal,
  think: Lightbulb,
  fetch: Globe,
  other: Wrench,
}

import { messagePreview } from '../runtime/messagePreview'
import { RamuGlyph } from './AnimatedMark'
import { PullRequestWritesCard } from './PullRequestWritesCard'
import { TestDeviceWaitCard } from './TestDeviceWaitCard'
import { SettingsChangeCard } from './SettingsChangeCard'
import { ToolSuggestionCard } from './ToolSuggestionCard'
import { AttachmentTextSheet } from './AttachmentTextSheet'
import { LearningTurnLine } from './LearningReviews'

/** Drops the model change waiting for the next send; set by the chat screen that holds it. */
export const CancelPendingSettings = createContext<() => void>(() => {})

/** Who the thread's messages can start with, so a sent `@sonnet-5.5` reads as that model, as it did in the composer. */
export const ChatMentions = createContext<readonly DraftMention[]>([])

/**
 * Moves a running command to the background so the agent carries on (Claude only, while the turn is live); absent
 * where it can't, so rows don't offer it.
 */
const BackgroundTool = createContext<((toolUseId: string) => void) | undefined>(undefined)

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
      openSkill: (name: string) => {
        if (!taskId) return
        const { store, files } = latest.current
        const say = (text: string) => translate(store.language, text)
        void store.invoke(computerId, 'skills.list', taskId).then(
          (skills) => {
            const skill = skills.find((entry) => entry.name === name.replace(/^[$/]/, ''))
            if (!skill) return
            Alert.alert(skill.name, [skill.description, skill.path].filter(Boolean).join('\n\n'), [
              { text: say('Open'), onPress: () => void files.openLink(skill.path) },
              { text: say('Close'), style: 'cancel' },
            ])
          },
          () => {},
        )
      },
    }),
    [computerId, taskId],
  )
  const { sessionId } = chat
  const movable =
    chat.provider === 'claude-code' &&
    chat.status === 'running' &&
    !!sessionId &&
    store.computers.find((computer) => computer.id === computerId)?.access !== 'viewer'
  const background = useMemo(
    () =>
      movable
        ? (toolUseId: string) =>
            void latest.current.store
              .invoke(computerId, 'agent.backgroundTool', sessionId!, toolUseId)
              .catch((error) => showError(error instanceof Error ? error.message : String(error)))
        : undefined,
    [movable, computerId, sessionId],
  )
  return (
    <ReferenceContext.Provider value={actions}>
      <BackgroundTool.Provider value={background}>{children}</BackgroundTool.Provider>
    </ReferenceContext.Provider>
  )
}

/** What a long-pressed message can do, as the desktop's selection menu: quote it into the message box, or ask an aside about it. */
export const MessageMenu = createContext<{
  readOnly?: boolean
  quote(text: string): void
  quoteNew(text: string): void
  edit(seq: number, text: string, files: Attachment[]): void
  undo(seq: number): void
  aside(text: string, from: 'user' | 'assistant'): void
  /** Scrolls the chat to a row, such as a document's newest version. */
  goTo?(itemId: string): void
} | null>(null)

/**
 * Selecting a message's text uses the system's own selection in the native Markdown view, with Quote, New thread, Ask
 * aside and More beside Copy, as on the desktop. "More" offers the whole message's actions. Where there is no native view
 * (the web build), a long press opens those actions instead.
 */
function MessageActions({
  text,
  from,
  seq,
  files,
  children,
}: {
  text: string
  from: 'user' | 'assistant'
  seq?: number
  files?: Attachment[]
  children: ReactNode
}) {
  const menu = useContext(MessageMenu)
  const say = useSay()
  const latestMenu = useRef(menu)
  latestMenu.current = menu
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
  if (!nativeMarkdown)
    return (
      <Pressable onLongPress={open} delayLongPress={350} accessibilityHint={say('Long-press for message actions')}>
        {children}
      </Pressable>
    )
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
}

/** An image in the chat: fits the column, keeps its aspect ratio, and opens large when tapped. */
function ImageBlock({ uri, alt, size }: { uri: string; alt?: string; size?: number }) {
  const { c } = useTheme()
  const [ratio, setRatio] = useState(4 / 3)
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
    <ImagePreview uri={uri} alt={alt}>
      <Image
        source={{ uri }}
        resizeMode="cover"
        style={
          size
            ? { width: size, height: size, borderRadius: radius.s, backgroundColor: c.fill }
            : { width: '100%', maxWidth: 360, aspectRatio: ratio, borderRadius: radius.m, backgroundColor: c.fill }
        }
      />
    </ImagePreview>
  )
}

/** A file you attached: images show as thumbnails (fetched from the computer), other files as a chip. */
function AttachmentTile({ file, computerId }: { file: Attachment; computerId: string }) {
  const { c } = useTheme()
  const store = useStore()
  const say = useSay()
  const [reading, setReading] = useState(false)
  const image = file.mimeType.startsWith('image/')
  // A picture this phone just sent shows from its own copy, without waiting for the host's thumbnail.
  const [uri, setUri] = useState<string | null>(() => attachmentPreview(file.id))
  useEffect(() => {
    if (!image || uri || !store.isOnline(computerId)) return
    let alive = true
    void store.invoke(computerId, 'attachments.preview', file.id).then(
      (value) => {
        if (alive) setUri(value)
      },
      () => {},
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [file.id, image, computerId] by design; the values it reads beyond these are current as of that run
  }, [file.id, image, computerId])
  if (image && uri) return <ImageBlock uri={uri} alt={file.name} size={88} />
  if (isModelFile(file)) return <ModelTile file={file} computerId={computerId} />
  // Any other file opens its text, as the desktop's preview does.
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={file.name}
        accessibilityHint={say('Opens the file')}
        onPress={() => {
          tap()
          setReading(true)
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          height: 26,
          paddingHorizontal: 8,
          borderRadius: radius.s,
          backgroundColor: c.fill,
          opacity: pressed ? 0.6 : 1,
          maxWidth: 220,
        })}
      >
        <T size={font.caption + 1} tone="soft" numberOfLines={1}>{`📎 ${file.name}`}</T>
      </Pressable>
      <AttachmentTextSheet computerId={computerId} file={reading ? file : null} onClose={() => setReading(false)} />
    </>
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
            <AttachmentTile key={file.id} file={file} computerId={chat.computerId} />
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
/** Rows that read the rest of the chat: an error offers Retry only while it ended the thread; helper cards read it whole. */
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
    const text = item.kind === 'user' || item.kind === 'text' ? item.text : null
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

/** The day label above a turn, and above a message on its way that will start one. */
export function ChatDateLabel({ date }: { date: string }) {
  return (
    <T
      size={font.caption}
      tone="muted"
      style={{ textAlign: 'center', marginBottom: space.l, fontVariant: ['tabular-nums'] }}
      accessibilityRole="header"
    >
      {date}
    </T>
  )
}

export function TranscriptItemView({ item, chat, meta }: { item: TranscriptItem; chat: Chat; meta?: ItemMeta }) {
  return (
    <ChatReferences chat={chat}>
      {meta?.date ? <ChatDateLabel date={meta.date} /> : null}
      <TranscriptBlock item={item} chat={chat} meta={meta} />
    </ChatReferences>
  )
}

/** Time of an answer and a copy button, like the desktop's row under each reply. */
/** The row under a message: its time and Copy, and on the person's own message Edit; one height in every state. */
export const MessageFooter = memo(function MessageFooter({
  at,
  text,
  copyLabel,
  end = false,
  status,
  onEdit,
}: {
  at?: number
  text: string
  copyLabel: string
  /** Lined up at the right, under the person's own bubble. */
  end?: boolean
  /** Said in place of the time and buttons while the message is still on its way ("Sending…"). */
  status?: string
  onEdit?: () => void
}) {
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
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: end ? 'flex-end' : 'flex-start',
        gap: space.xs,
        marginTop: space.xs,
        height: 28,
      }}
    >
      {status ? (
        <T size={font.caption} tone="muted" numberOfLines={1}>
          {status}
        </T>
      ) : (
        <>
          {time ? (
            <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
              {time}
            </T>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? say('Copied') : copyLabel}
            hitSlop={10}
            onPress={() => {
              tap()
              void Clipboard.setStringAsync(text).then(() => setCopied(true))
            }}
            style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
          >
            {copied ? <Check size={14} color={c.ok} /> : <Copy size={14} color={c.muted} />}
          </Pressable>
          {onEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={say('Edit from here')}
              hitSlop={10}
              onPress={() => {
                tap()
                onEdit()
              }}
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
            >
              <Pencil size={14} color={c.muted} />
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  )
})

/** Under a turn's last answer: its time and Copy. */
function ReplyFooter({ at, text }: { at?: number; text: string }) {
  const say = useSay()
  return <MessageFooter at={at} text={text} copyLabel={say('Copy reply')} />
}

/** The person's own message: its time, Copy and, where the thread can be changed, Edit from here, as on the desktop. */
function UserFooter({ at, text, seq, files }: { at?: number; text: string; seq?: number; files?: Attachment[] }) {
  const say = useSay()
  const menu = useContext(MessageMenu)
  const latest = useRef(menu)
  latest.current = menu
  const editable = !!menu && !menu.readOnly && seq !== undefined
  return (
    <MessageFooter
      end
      at={at}
      text={text}
      copyLabel={say('Copy message')}
      onEdit={editable ? () => !latest.current?.readOnly && latest.current?.edit(seq!, text, files ?? []) : undefined}
    />
  )
}

const RESUME_PROMPT = '\n\n<ramu-context>\nContinue where you left off.\n</ramu-context>'

/** "×3" after a notice shown once for a run of the same one; nothing for a single occurrence. */
function RepeatCount({ count }: { count: number | undefined }) {
  const say = useSay()
  if (!count || count < 2) return null
  return (
    <T
      size={font.caption}
      tone="muted"
      accessibilityLabel={say('Happened {0} times in a row', { 0: count })}
      style={{ fontVariant: ['tabular-nums'] }}
    >
      {say('×{0}', { 0: count })}
    </T>
  )
}

/** An error in the thread, in the same words as the desktop: what happened, then the provider's message. */
function ErrorCard({ message, last, chat, repeats }: { message: string; last: boolean; chat: Chat; repeats?: number }) {
  const { c } = useTheme()
  const say = useSay()
  const store = useStore()
  const { title, action } = agentErrorView(message)
  // While a usage limit holds the thread, the tray above the composer owns trying again.
  const canRetry =
    action === 'retry' &&
    last &&
    !limitWaitOf(chat.items, chat.doneAt) &&
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <T size={font.control} weight="600" style={{ flexShrink: 1 }}>
              {say(title)}
            </T>
            <RepeatCount count={repeats} />
          </View>
          {/* Drawn by the Markdown view so its words select with the same native menu as any reply. */}
          <Markdown text={message} density="compact" muted />
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
      if (item.from?.kind === 'ramu') return <RamuEventRow from={item.from} />
      if (item.from) return <ThreadMessageCard from={item.from} chat={chat} />
      return (
        <MessageActions text={item.text} from="user" seq={item.seq} files={item.attachments}>
          <UserBubble text={item.text} attachments={item.attachments} chat={chat} />
          {item.raw ? <SentContextChips raw={item.raw} computer={chat.computerId} /> : null}
          <UserFooter at={item.at} text={item.text} seq={item.seq} files={item.attachments} />
        </MessageActions>
      )
    case 'error':
      return (
        <ErrorCard message={item.message} last={endedOnError(chat.items, item.id)} chat={chat} repeats={item.repeats} />
      )
    case 'text':
      return (
        <MessageActions text={item.text} from="assistant">
          <Markdown text={item.text} streaming={meta?.streaming} fresh={meta?.fresh} />
          {meta?.footer && !meta.streaming ? <ReplyFooter at={item.at} text={item.text} /> : null}
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
    case 'inline-ui':
      return <InlineUiCard surface={item.surface} chat={chat} />
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
    case 'tool-suggestion':
      return <ToolSuggestionCard computerId={chat.computerId} cardId={item.cardId} />
    case 'continued':
      return <ContinuedCard event={item.event} chat={chat} />
    case 'checkout-clash':
      return <CheckoutClashCard path={item.path} taskId={item.taskId} chat={chat} />
    case 'command-wait':
      return <CommandWaitNote taskId={item.taskId} chat={chat} />
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
        <TurnSummary label={item.label} running={item.running} empty={!item.items.length}>
          {item.items.map((child) => (
            <TranscriptItemView key={child.id} item={child} chat={chat} />
          ))}
        </TurnSummary>
      )
    case 'note':
      // As on the desktop, the limit tray above the composer says when the thread resumes; a line here would repeat it.
      if (item.wait && item.limit) return null
      return item.goalNote ? <GoalNote item={item} /> : <NoteRow item={item} chat={chat} />
    case 'learning':
      return <LearningTurnLine item={item} computerId={chat.computerId} />
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
function ThreadMessageCard({
  from,
  chat,
}: {
  from: Exclude<import('@ramu/shared/types').MessageOrigin, { kind: 'ramu' }>
  chat: Chat
}) {
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
            <Markdown text={from.detail} density="compact" />
          </Collapse>
        </View>
      ) : null}
    </Card>
  )
}

const ACCESS = { edits: 'Allow edits', auto: 'Auto', full: 'Full access' } as const
/** A status line with a rule on both sides, like the desktop's separators: "Opus Medium" over "Changed conversation settings". */
/** The desktop's marks for the same status lines. */
const NOTE_ICONS: Record<NoteIcon, LucideIcon> = {
  compaction: Minimize2,
  recovery: RotateCcw,
  stop: OctagonX,
  command: SquareTerminal,
  schedule: CalendarClock,
  advice: Lightbulb,
  message: Send,
  answers: MessageSquareReply,
  card: MousePointerClick,
}

function NoteRow({ item, chat }: { item: Extract<TranscriptItem, { kind: 'note' }>; chat: Chat }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const [undoing, setUndoing] = useState(false)
  const cancelPending = useContext(CancelPendingSettings)
  // As on the desktop: a settings change can be undone, restoring the previous settings for the next message.
  const configure = (settings: import('@ramu/shared/types').AgentSettings, when?: 'now') => {
    tap()
    setUndoing(true)
    void store
      .invoke(chat.computerId, 'agent.configure', chat.sessionId!, settings, when)
      .then(() => store.refresh(chat.computerId, true))
      .catch((error) => Alert.alert(say('Model'), error instanceof Error ? error.message : String(error)))
      .finally(() => setUndoing(false))
  }
  const undo =
    item.previous && chat.sessionId && !item.pending && !item.held
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
  const Icon = item.icon ? NOTE_ICONS[item.icon] : null
  let title = item.goalNote ? say(GOAL_NOTE_LABELS[item.goalNote]) : item.title
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s }}>
            {Icon ? <Icon size={13} color={item.failed ? c.bad : c.muted} style={{ flexShrink: 0 }} /> : null}
            <T size={font.caption} tone={item.failed ? 'bad' : 'muted'} style={{ textAlign: 'center', flexShrink: 1 }}>
              {title}
            </T>
            <RepeatCount count={item.repeats} />
          </View>
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
        {item.held && item.settings && chat.sessionId ? (
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.l, marginTop: 2 }}
          >
            <Pressable
              accessibilityRole="button"
              disabled={undoing}
              onPress={() => configure(item.settings!, 'now')}
              hitSlop={8}
              style={{ opacity: undoing ? 0.5 : 1 }}
            >
              <T size={font.caption} weight="600" tone="accent">
                {say('Change now and stop them')}
              </T>
            </Pressable>
            {item.previous ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={say('Cancel the model change')}
                disabled={undoing}
                onPress={() => configure(item.previous!)}
                hitSlop={8}
                style={{ opacity: undoing ? 0.5 : 1 }}
              >
                <T size={font.caption} weight="600" tone="accent">
                  {say('Cancel · stay on {0}', { 0: label(item.previous) })}
                </T>
              </Pressable>
            ) : null}
          </View>
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
function TurnSummary({
  label,
  running,
  empty = false,
  children,
}: {
  label: string
  running?: Extract<TranscriptItem, { kind: 'summary' }>['running']
  /** A turn still running: its steps show under this row instead of folding into it, so there is nothing to open. */
  empty?: boolean
  children: ReactNode
}) {
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const since = running?.since
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (since === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  return (
    <View style={{ gap: space.m }}>
      <Pressable
        accessibilityRole={empty ? 'text' : 'button'}
        accessibilityState={empty ? undefined : { expanded: open }}
        disabled={empty}
        onPress={() => {
          tap()
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
          {running ? say(running.text, { 0: formatDuration(Math.max(0, now - running.since)) }) : say(label)}
        </T>
        {empty ? null : <Disclosure open={open} color={c.muted} />}
      </Pressable>
      <Collapse open={open && !empty}>
        {/* Folded steps read as one list, as tool rows inside a group do. */}
        <View style={{ gap: space.xs }}>{children}</View>
      </Collapse>
    </View>
  )
}

/**
 * The person's message. A message still on its way is drawn by this same bubble, so the host's copy taking its place
 * changes nothing on screen; `waiting` marks one held on the phone.
 */
export function UserBubble({
  text,
  attachments,
  chat,
  computerId,
  waiting = false,
}: {
  text: string
  attachments?: Attachment[]
  chat?: Chat
  /** The host of a message still on its way, which has no thread item yet. */
  computerId?: string
  waiting?: boolean
}) {
  const { c } = useTheme()
  const say = useSay()
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
      {attachments?.length && (chat?.computerId ?? computerId) ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
          {attachments.map((file) => (
            <AttachmentTile key={file.id} file={file} computerId={(chat?.computerId ?? computerId)!} />
          ))}
        </View>
      ) : null}
      {quotes.length || hasText ? (
        <View
          style={{
            backgroundColor: c.bubble,
            opacity: waiting ? 0.6 : 1,
            borderRadius: radius.l - 2,
            borderBottomRightRadius: radius.xs,
            paddingHorizontal: space.m + 2,
            paddingVertical: space.s + 2,
            gap: space.s,
            // Drawn on every bubble, so marking one held on the phone does not change its size.
            borderWidth: 1,
            borderStyle: waiting ? 'dashed' : 'solid',
            borderColor: waiting ? c.lineStrong : 'transparent',
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

/** Terminal output, artifacts and review comments a sent message carried, under its bubble as on the desktop. */
function SentContextChips({ raw, computer }: { raw: string; computer: string }) {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const context = useMemo(() => sentContext(raw), [raw])
  const [open, setOpen] = useState<number | null>(null)
  if (!hasSentContext(context)) return null
  const where = (comment: SentReviewComment) => {
    if (comment.scope === 'file') return say('File')
    const lines = comment.endLine !== comment.line ? `${comment.line}–${comment.endLine}` : String(comment.line)
    const many = comment.endLine !== comment.line
    if (comment.side === 'old') return say(many ? 'Old lines {0}' : 'Old line {0}', { 0: lines })
    return say(many ? 'Lines {0}' : 'Line {0}', { 0: lines })
  }
  const shown = open === null ? null : context.terminal[open]
  return (
    <View
      style={{ alignSelf: 'flex-end', maxWidth: '86%', gap: space.xs, alignItems: 'flex-end', marginTop: space.xs }}
    >
      {context.comments.map((comment, index) => (
        <View
          key={`comment-${index}`}
          style={{ backgroundColor: c.fill, borderRadius: radius.m, padding: space.s, gap: 2, alignSelf: 'stretch' }}
        >
          <T size={font.caption} tone="muted" numberOfLines={1}>
            {comment.path} · {where(comment)}
          </T>
          <T size={font.control}>{comment.text}</T>
        </View>
      ))}
      {context.artifacts.length || context.terminal.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, justifyContent: 'flex-end' }}>
          {context.artifacts.map((item) => (
            <Chip
              key={`${item.id}:${item.version}`}
              small
              icon={AppWindow}
              label={`${item.title} v${item.version}`}
              maxLabelWidth={220}
              accessibilityLabel={say('Asked about {0}', { 0: item.title })}
              onPress={() => {
                tap()
                router.push({ pathname: '/artifact/[computer]/[id]', params: { computer, id: item.id } })
              }}
            />
          ))}
          {context.terminal.map((item, index) => (
            <Chip
              key={`terminal-${index}`}
              small
              icon={SquareTerminal}
              label={terminalAttachmentLabel(item)}
              selected={open === index}
              maxLabelWidth={220}
              accessibilityHint={say('Shows the terminal output sent with this message')}
              onPress={() => {
                tap()
                setOpen((current) => (current === index ? null : index))
              }}
            />
          ))}
        </View>
      ) : null}
      {shown ? (
        <View style={{ backgroundColor: c.fill, borderRadius: radius.m, padding: space.s, alignSelf: 'stretch' }}>
          <T size={font.caption} style={{ fontFamily: font.mono }} numberOfLines={30} selectable>
            {shown.text}
          </T>
        </View>
      ) : null}
    </View>
  )
}

/** A sent message, or only its beginning with a control to show the rest when it is long. */
function LongMessage({
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
  const say = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  // Reads, edits and writes name the file; every other call reads as the desktop's row does.
  if (item.file)
    return {
      verb: say(toolVerb(item.verb, running)),
      subject: `${item.file.name}${item.file.others ? ` ${say('+{count} more', { count: item.file.others })}` : ''}`,
    }
  return toolRowWords(item.source, item.source.kind, running, say)
}

/** `live`: the newest group of a running turn, so its headline names the latest call, as the desktop's does. */
function ToolGroup({ item, live }: { item: Extract<TranscriptItem, { kind: 'tools' }>; live: boolean }) {
  const { c } = useTheme()
  const { language } = useStore()
  const say = useSay()
  const [open, setOpen] = useState(false)
  const { current, running, failed } = toolActivity(item.tools, (tool) =>
    tool.status === 'in_progress' ? 'running' : tool.status === 'failed' ? 'failed' : 'done',
  )
  const shown = live && !running ? (item.tools.at(-1) ?? current) : current
  const words = shown ? toolWords(shown, language, shown.status === 'in_progress') : null
  // The live group's newest step may be a thought, so its headline reads what the agent is considering now.
  const latest = item.entries.at(-1)
  const thought = live && !running && latest?.kind === 'thinking' ? latest : undefined
  // Until the live group settles, its latest thought stays under the headline, between calls too, instead of hiding in
  // the closed group the moment a call finishes.
  const lastThought = live && !thought ? item.entries.findLast((entry) => entry.kind === 'thinking') : undefined
  const lastThoughtLine = lastThought ? thoughtEnding(lastThought.text) : ''
  const headline = thought
    ? thoughtLine(thought.text, true) || say('Thinking')
    : live || running || failed
      ? `${words?.verb ?? ''} ${words?.subject ?? ''}`.trim()
      : // A settled group reads as the desktop's does: "Ran pnpm test, Read 3 files".
        summarizeTools(
          item.tools.map((tool) => ({
            name: tool.source.name,
            running: tool.status === 'in_progress',
            kind: tool.source.kind,
            subject: tool.file?.name ?? tool.source.summary,
            ...(tool.source.title ? { title: tool.source.title } : {}),
            ...(tool.ramu && tool.source.ramu
              ? {
                  ramu: {
                    key: tool.source.ramu,
                    done: tool.ramu.done,
                    running: tool.ramu.running,
                    subject: tool.ramu.subject,
                  },
                }
              : {}),
          })),
          say,
        )
  const lastFailed = item.tools.findLast((tool) => tool.status === 'failed')
  const lastFailedWords = lastFailed ? toolWords(lastFailed, language, false) : { verb: '', subject: '' }
  const lastFailedLine = lastFailed ? toolFailure(lastFailed.detail).lines.at(-1) : undefined
  // A group of Ramu's own tools wears its mark, as each of its rows does.
  const ramuGroup = item.tools.every((tool) => tool.ramu)
  const Icon = shown ? toolIcons[shown.tool] : Wrench
  // While working, only the words shimmer; the icon stays still, as on the desktop.
  const tint = failed ? c.bad : c.muted
  return (
    <View style={{ gap: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}
      >
        {thought ? (
          <Brain size={14} color={tint} />
        ) : ramuGroup || shown?.ramu ? (
          <RamuGlyph size={14} color={tint} />
        ) : (
          <Icon size={14} color={tint} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* The line changes in place: the next call, a new paragraph of thought or the summary once the group settles
              takes its place at once, so the row never seems to jump between tools. */}
          <ActivityText active={running > 0 || live}>{headline}</ActivityText>
        </View>
        {failed > 0 ? (
          // A quiet mark, as in T3 Code: the tinted icon and this cross say it failed; the words stay the tool's own.
          <View
            accessibilityLabel={failed > 1 ? say('{0} failed', { 0: failed }) : say('Failed')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <CircleX size={13} color={c.bad} />
            {failed > 1 ? (
              <T size={font.caption} tone="bad">
                {failed}
              </T>
            ) : null}
          </View>
        ) : null}
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      {/* One line under the headline: why the latest step failed, or while the group is live its latest thought. The
          live group keeps that line even when it is empty, as T3 Code's work rows keep one height, so the end of the
          chat does not move as thoughts and steps come and go; it leaves with the newer row that ends the group's turn. */}
      {open ? null : !running && lastFailed && lastFailedLine ? (
        <T size={font.caption} tone="muted" numberOfLines={1} style={{ marginLeft: 22 }}>
          {lastFailed === shown
            ? lastFailedLine
            : `${`${lastFailedWords.verb} ${lastFailedWords.subject}`.trim()}: ${lastFailedLine}`}
        </T>
      ) : live ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginLeft: 1 }}>
          {lastThoughtLine ? <Brain size={12} color={c.muted} /> : null}
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {lastThoughtLine || ' '}
          </T>
        </View>
      ) : null}
      {/* Opens and closes at once, as T3 Code's work log does, and rows that arrive while it is open simply appear: a
          height animation here would replay with every new call and move the reply below while the person reads. */}
      {open ? (
        <View style={{ gap: space.xs }}>
          {item.entries.map((entry, index) =>
            entry.kind === 'thinking' ? (
              <ThinkingRow key={entry.id} text={entry.text} live={live && index === item.entries.length - 1} />
            ) : (
              <ToolRow key={entry.id} item={entry} />
            ),
          )}
        </View>
      ) : null}
    </View>
  )
}

function PlanCard({ item }: { item: Extract<TranscriptItem, { kind: 'plan' }> }) {
  const { c } = useTheme()
  const { language } = useStore()
  const [open, setOpen] = useState(true)
  const completed = item.entries.filter((entry) => entry.status === 'completed').length
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
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

/**
 * What a failed call said, under its closed row. A command keeps its exit code and last output lines in monospace; any
 * other tool says its error once, in plain words, and opening the row shows the rest.
 */
function ToolFailureLines({ output, shell }: { output: string | undefined; shell: boolean }) {
  const { c } = useTheme()
  const say = useSay()
  const { exit, lines } = toolFailure(output)
  if (!lines.length && exit === undefined) return null
  if (!shell)
    return (
      <T size={font.caption} tone="muted" numberOfLines={1} style={{ marginLeft: 22, marginBottom: 4 }}>
        {lines.at(-1)}
      </T>
    )
  return (
    <View
      style={{ marginLeft: 22, marginBottom: 4, paddingLeft: space.s, borderLeftWidth: 2, borderLeftColor: c.badWash }}
    >
      {exit !== undefined ? (
        <T size={font.caption} mono tone="bad">
          {say('Exit code {0}', { 0: exit })}
        </T>
      ) : null}
      {lines.map((line, index) => (
        <T key={index} size={font.caption} mono tone="soft" numberOfLines={1}>
          {line}
        </T>
      ))}
    </View>
  )
}

function ToolRow({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  const say = useSay()
  const { c } = useTheme()
  const { language: storeLanguage } = useStore()
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
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
  const background = useContext(BackgroundTool)
  const movable = !!background && running && !item.ramu && item.verb === 'Bash'
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: !openable }}
        disabled={!openable}
        onPress={() => {
          tap()
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
        {failed ? <CircleX size={13} color={c.bad} accessibilityLabel={say('Failed')} /> : null}
        {movable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={say('Let the agent carry on while this keeps running')}
            hitSlop={8}
            onPress={() => {
              tap()
              background(item.id)
            }}
          >
            <T size={font.caption} weight="600" tone="accent">
              {say('Run in background')}
            </T>
          </Pressable>
        ) : null}
        {openable ? <Disclosure open={open} color={c.muted} /> : null}
      </Pressable>
      {failed && !open ? <ToolFailureLines output={item.detail} shell={item.tool === 'execute'} /> : null}
      {open ? (
        <>
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
        </>
      ) : null}
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
  return <Helpers item={item} chat={chat} />
}

function QuestionHistory({ item }: { item: QuestionItem }) {
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

function QuestionHistoryEntry({ question, answer }: { question: AgentQuestion; answer?: string }) {
  const { c } = useTheme()
  const { language } = useStore()
  const [open, setOpen] = useState(false)
  const selected = new Set(answer ? (question.multiSelect ? answer.split(', ') : [answer]) : [])
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        disabled={!question.options.length}
        accessibilityRole={question.options.length ? 'button' : 'text'}
        accessibilityState={question.options.length ? { expanded: open } : undefined}
        onPress={() => {
          tap()
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

type QuestionItem = Extract<TranscriptItem, { kind: 'question' }>

/**
 * Set where a request is answered in place (the activity sheet, the Inbox): there is no message box to compete with, and
 * a sheet would open over a sheet.
 */
export const InlineRequests = createContext(false)

/** Questions that already opened their sheet by themselves, so closing one never brings it back on its own. */
const autoOpenedQuestions = new Set<string>()

/**
 * The question whose sheet is open. Several waiting questions open one at a time: the next opens by itself once the
 * person closes or answers the one before.
 */
let openQuestion: string | null = null
const openQuestionListeners = new Set<() => void>()
function setOpenQuestion(key: string | null) {
  openQuestion = key
  for (const listener of openQuestionListeners) listener()
}
function useOpenQuestion() {
  return useSyncExternalStore(
    (listener) => {
      openQuestionListeners.add(listener)
      return () => openQuestionListeners.delete(listener)
    },
    () => openQuestion,
  )
}

function QuestionCard({ item, chatId }: { item: QuestionItem; chatId: string }) {
  const inline = useContext(InlineRequests)
  if (item.answers) return <QuestionHistory item={item} />
  return inline ? <QuestionInline item={item} chatId={chatId} /> : <QuestionPrompt item={item} chatId={chatId} />
}

/** The picks and typed answers for one request, kept as a draft until it is answered. */
function useQuestionAnswer(item: QuestionItem, chatId: string) {
  const store = useStore()
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
  const key = (q: AgentQuestion) => q.id ?? q.question
  const answered = (q: AgentQuestion) => (picked[key(q)]?.length ?? 0) > 0 || Boolean(other[key(q)]?.trim())
  const value = (q: AgentQuestion) => [...(picked[key(q)] ?? []), other[key(q)]?.trim()].filter(Boolean).join(', ')
  return {
    picked,
    other,
    started: item.questions.some(answered),
    ready: item.questions.every(answered),
    pick(q: AgentQuestion, label: string) {
      const selected = picked[key(q)]?.includes(label) ?? false
      setOther((old) => ({ ...old, [key(q)]: '' }))
      setPicked((old) => {
        const current = old[key(q)] ?? []
        const next = q.multiSelect
          ? selected
            ? current.filter((x) => x !== label)
            : [...current, label]
          : selected
            ? []
            : [label]
        return { ...old, [key(q)]: next }
      })
    },
    type(q: AgentQuestion, value: string) {
      setPicked((old) => ({ ...old, [key(q)]: [] }))
      setOther((old) => ({ ...old, [key(q)]: value }))
    },
    answered,
    submit() {
      store.answer(chatId, item.id, Object.fromEntries(item.questions.map((q) => [key(q), value(q)])))
    },
    /** Questions the agent marked as separate can each be sent on their own, as on the desktop. */
    sendOne(q: AgentQuestion) {
      store.answer(chatId, item.id, { [key(q)]: value(q) })
    },
    dismiss() {
      store.answer(chatId, item.id, { _: 'Dismissed' })
    },
  }
}

type QuestionAnswer = ReturnType<typeof useQuestionAnswer>

/**
 * A waiting question in the transcript: what is asked and one way to answer it. The answer is written in a sheet, which
 * covers the thread's message box, so only one field takes the keyboard and Submit clearly sends the answer.
 */
function QuestionPrompt({ item, chatId }: { item: QuestionItem; chatId: string }) {
  const say = useSay()
  const { c } = useTheme()
  const state = useQuestionAnswer(item, chatId)
  const autoKey = `${chatId}:${item.id}`
  const openNow = useOpenQuestion()
  const open = openNow === autoKey
  const close = () => {
    if (openQuestion === autoKey) setOpenQuestion(null)
  }
  // An answered or vanished question frees the sheet for the next one.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- releases only on unmount
  useEffect(() => close, [autoKey])
  const [focused, setFocused] = useState(false)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => {
        setFocused(false)
        // Leaving the thread takes its question sheet with it.
        if (openQuestion === autoKey) setOpenQuestion(null)
      }
    }, [autoKey]),
  )
  const show = () => {
    // The message box may hold the keyboard; the sheet's field takes it instead.
    Keyboard.dismiss()
    setOpenQuestion(autoKey)
  }
  // Typing an answer brings Submit into view above the keyboard: the sheet keeps the field there, and Submit, below it,
  // stayed behind the keys.
  const form = useRef<import('react-native').ScrollViewInstance>(null)
  useEffect(() => {
    if (!open) return
    const shown = Keyboard.addListener('keyboardDidShow', () => form.current?.scrollToEnd({ animated: true }))
    return () => shown.remove()
  }, [open])
  // A question waiting while its thread is on screen opens once by itself, so answering takes no extra tap.
  useEffect(() => {
    // Read live: questions arriving together run this in the same commit, and the first one takes the sheet.
    if (!focused || openQuestion !== null || autoOpenedQuestions.has(autoKey)) return
    autoOpenedQuestions.add(autoKey)
    show()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- show reads only autoKey; openNow re-runs it when a sheet closes
  }, [focused, openNow, autoKey])
  const [first, ...rest] = item.questions
  const many = item.questions.length > 1
  return (
    <>
      <Card style={{ padding: space.m, gap: space.s, backgroundColor: c.raised2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <MessageCircleQuestion size={14} color={c.warn} />
          <T size={font.caption} weight="600" tone="warn" style={{ flex: 1 }}>
            {many ? say('{0} questions for you', { 0: item.questions.length }) : say('Question for you')}
          </T>
        </View>
        <T size={font.body} weight="600" numberOfLines={3} style={{ lineHeight: 21 }}>
          {first?.question}
        </T>
        {rest.length ? (
          <T size={font.control} tone="muted" numberOfLines={2}>
            {rest.map((q) => q.question).join(' · ')}
          </T>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Button
            title={say(state.started ? 'Continue answering' : 'Answer')}
            accessibilityLabel={`${say(state.started ? 'Continue answering' : 'Answer')}: ${first?.question ?? ''}`}
            onPress={show}
          />
        </View>
      </Card>
      <Sheet
        open={open}
        onClose={close}
        title={
          many ? say('{0} questions for you', { 0: item.questions.length }) : first?.header || say('Question for you')
        }
        scroll={false}
      >
        <SheetScrollView ref={form} style={{ flexGrow: 0 }}>
          <View style={{ paddingHorizontal: space.l, gap: space.l }}>
            <QuestionForm item={item} state={state} headers={many} />
            <QuestionActions state={state} onDone={close} />
          </View>
        </SheetScrollView>
      </Sheet>
    </>
  )
}

/** The whole form in place, where nothing else on screen takes typing. */
function QuestionInline({ item, chatId }: { item: QuestionItem; chatId: string }) {
  const { c } = useTheme()
  const state = useQuestionAnswer(item, chatId)
  return (
    <Card style={{ padding: space.m, gap: space.m, backgroundColor: c.raised2 }}>
      <QuestionForm item={item} state={state} headers />
      <QuestionActions state={state} />
    </Card>
  )
}

function QuestionForm({ item, state, headers }: { item: QuestionItem; state: QuestionAnswer; headers: boolean }) {
  const say = useSay()
  const { c } = useTheme()
  // The last question left is sent with Submit, so it needs no button of its own.
  const separate = item.grouping === 'independent' && item.questions.length > 1
  return (
    <>
      {item.submitted ? (
        <T tone="muted" size={font.caption}>
          {say('Already submitted: {0}', { 0: Object.values(item.submitted).join(' · ') })}
        </T>
      ) : null}
      {item.questions.map((q) => {
        const key = q.id ?? q.question
        return (
          <View key={key} style={{ gap: space.s }}>
            {headers && q.header ? (
              <T
                size={font.caption}
                weight="600"
                tone="warn"
                style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}
              >
                {q.header}
              </T>
            ) : null}
            <T size={font.body} weight="600" style={{ lineHeight: 21, marginBottom: 2 }}>
              {q.question}
            </T>
            {q.options.map((o) => (
              <Option
                key={o.label}
                label={o.label}
                description={o.description}
                multi={q.multiSelect}
                selected={state.picked[key]?.includes(o.label) ?? false}
                onPress={() => state.pick(q, o.label)}
              />
            ))}
            <TextInput
              placeholder={say(q.options.length ? 'Other answer…' : 'Your answer…')}
              placeholderTextColor={c.placeholder}
              value={state.other[key] ?? ''}
              accessibilityLabel={q.question}
              multiline
              onChangeText={(value) => state.type(q, value)}
              style={{
                color: c.text,
                fontSize: font.body - 1,
                padding: space.m,
                paddingTop: space.m,
                maxHeight: 160,
                borderRadius: radius.s + 2,
                backgroundColor: c.fill,
              }}
            />
            {separate && state.answered(q) ? (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Button kind="secondary" title={say('Send answer')} onPress={() => state.sendOne(q)} />
              </View>
            ) : null}
          </View>
        )
      })}
    </>
  )
}

function QuestionActions({ state, onDone }: { state: QuestionAnswer; onDone?: () => void }) {
  const say = useSay()
  return (
    <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
      <Button
        kind="ghost"
        title={say('Dismiss')}
        onPress={() => {
          state.dismiss()
          onDone?.()
        }}
      />
      <Button
        title={say('Submit')}
        disabled={!state.ready}
        onPress={() => {
          state.submit()
          onDone?.()
        }}
      />
    </View>
  )
}

function PermissionCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'permission' }>; chatId: string }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const { decide, forgetApproval } = store
  const router = useRouter()
  const [rule, setRule] = useState('exact')
  // A new project's folder: what the host proposed until the person picks another.
  const [parent, setParent] = useState(item.projectLocation?.parent ?? null)
  const chat = store.chats.find((entry) => entry.id === chatId)
  const viewer = store.computers?.find((host) => host.id === chat?.computerId)?.access === 'viewer'
  const [problem, setProblem] = useState<string | null>(null)
  const createProject = () => {
    if (!chat?.sessionId || !parent || parent === item.projectLocation?.parent) return decide(chatId, item.id, 'allow')
    setProblem(null)
    void store
      .invoke(chat.computerId, 'agent.createProjectIn', chat.sessionId, item.id, parent)
      .then(() => store.refresh(chat.computerId))
      .catch((reason: unknown) => setProblem(reason instanceof Error ? reason.message : String(reason)))
  }
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
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
        <ShieldAlert size={16} color={c.warn} strokeWidth={1.8} style={{ marginTop: 3 }} />
        {/* A long command title wraps inside the card; the full command is in the block below. */}
        <T size={font.body} weight="600" numberOfLines={3} style={{ flex: 1, minWidth: 0 }}>
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
      {item.fullAccess ? <FullAccessWhy reason={item.fullAccess.reason} /> : null}
      {item.projectLocation && parent ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <FolderOpen size={14} color={c.muted} />
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {say('In {0}', { 0: parent })}
          </T>
          {chat && !viewer ? (
            <Button
              kind="ghost"
              title={say('Change…')}
              accessibilityLabel={say('Change where the project goes')}
              onPress={() =>
                void pickFolder(() =>
                  router.push({
                    pathname: '/folders',
                    params: { purpose: 'parent', computer: chat.computerId, start: parent },
                  }),
                ).then((path) => path && setParent(path))
              }
            />
          ) : null}
        </View>
      ) : null}
      {problem ? (
        <T size={font.caption} tone="bad" accessibilityLiveRegion="polite">
          {problem}
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
        {item.projectLocation ? (
          <Button title={say('Create project')} onPress={createProject} />
        ) : (
          <Button title={say('Allow once')} onPress={() => decide(chatId, item.id, 'allow')} />
        )}
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
        <Button
          kind="secondary"
          title={say(item.projectLocation ? 'Not now' : 'Deny')}
          onPress={() => decide(chatId, item.id, 'deny')}
        />
      </View>
      <T size={font.caption} tone="muted">
        {say(
          item.rememberable
            ? 'Saved approvals apply to the selected rule. Allow once applies only to this request.'
            : item.always
              ? 'Always allow lets this tool run without asking. Change it back in Customize → MCP servers.'
              : item.productionDeploy
                ? 'Allow in this thread lasts until the thread ends or Ramu restarts; other threads still ask.'
                : item.projectLocation
                  ? 'Your next project goes in the same place unless you change it.'
                  : 'Applies to this request only.',
        )}
      </T>
    </Card>
  )
}

/** As on the desktop: Full access still asks, and Why? opens the reason and what Full access skips. */
function FullAccessWhy({ reason }: { reason?: string }) {
  const say = useSay()
  const [open, setOpen] = useState(false)
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }}>
        <T size={font.caption} tone="muted">
          {say('Full access still asks before this.')}
        </T>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          hitSlop={8}
          onPress={() => {
            tap()
            setOpen((value) => !value)
          }}
        >
          <T size={font.caption} tone="accent">
            {say('Why?')}
          </T>
        </Pressable>
      </View>
      {open ? (
        <View style={{ gap: space.xs }}>
          {reason ? (
            <T size={font.caption} tone="soft">
              {reason}
            </T>
          ) : null}
          <T size={font.caption} tone="muted">
            {say('Always asks: deleting work for good, changing the computer, acting as you, deploying to production.')}
          </T>
          <T size={font.caption} tone="muted">
            {say('Allow once approves just this one.')}
          </T>
        </View>
      ) : null}
    </View>
  )
}

function ChangesCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'changes' }>; chatId: string }) {
  const { c } = useTheme()
  const router = useRouter()
  const { language } = useStore()
  const [expanded, setExpanded] = useState(false)
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
        ) : item.files.every((file) => file.binary) ? (
          <T size={font.caption} tone="muted">
            {say('Binary')}
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
              {file.binary ? (
                <T size={font.caption} tone="muted">
                  {say('Binary')}
                </T>
              ) : (
                stats(file.additions, file.deletions)
              )}
            </Pressable>
          ))}
      {!single && item.files.length > 3 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            tap()
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
  const say = useSay()
  const [open, setOpen] = useState(false)
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
  const title = say(GOAL_NOTE_LABELS[type])
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.objective ? `${title}: ${item.objective}` : title}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
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

/** A finished goal, as the desktop shows it: "Goal completed" and its objective on one line, the rest folded below. */
function GoalDone({ item }: { item: Extract<TranscriptItem, { kind: 'goal' }> }) {
  const { c } = useTheme()
  const say = useSay()
  const [open, setOpen] = useState(false)
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}
      >
        <CircleCheck size={14} color={c.ok} strokeWidth={1.8} />
        <T size={font.control} tone="soft">
          {say('Goal completed')}
        </T>
        <T size={font.control} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {item.objective}
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
      {item.request.url ? (
        <Button
          kind="secondary"
          title={say('Open {0}', { 0: new URL(item.request.url).host })}
          onPress={() => void Linking.openURL(item.request.url!)}
        />
      ) : null}
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
 * Reasoning the provider shared, as the desktop's ThinkingRow: led by the brain icon, which already says what the row
 * is, the thought on one line ending in an ellipsis (its newest paragraph, shimmering, while it streams), after
 * "Thought for 4s" once it took a while; a tap opens the whole thought as Markdown under a "Thinking" or "Thought" title.
 */
/**
 * A message Ramu sent the thread by itself (a check failed, a review came, a site answers again), drawn as a thought
 * or tool is: what happened on one line, and opened, the message the agent read. As on the desktop.
 */
function RamuEventRow({ from }: { from: Extract<import('@ramu/shared/types').MessageOrigin, { kind: 'ramu' }> }) {
  const { c } = useTheme()
  const say = useSay()
  const [open, setOpen] = useState(false)
  const title = say(from.title, from.values)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        disabled={!from.detail}
        onPress={() => {
          tap()
          setOpen((value) => !value)
        }}
        hitSlop={{ top: 4, bottom: 4 }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 4 }}
      >
        <BellRing size={14} color={c.muted} />
        <T size={font.control} tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {title}
        </T>
        {from.detail ? <Disclosure open={open} color={c.muted} /> : null}
      </Pressable>
      {from.detail ? (
        <Collapse open={open}>
          <View style={{ paddingTop: space.xs }}>
            <Markdown text={from.detail} density="compact" muted />
          </View>
        </Collapse>
      ) : null}
    </View>
  )
}

function ThinkingRow({ text, live }: { text: string; live: boolean }) {
  const { c } = useTheme()
  const say = useSay()
  const [open, setOpen] = useState(false)
  const line = useMemo(() => thoughtLine(text, live), [text, live])
  const [timing, setTiming] = useState(() => tickThought(NEW_THOUGHT, live, Date.now()))
  useEffect(() => setTiming((current) => tickThought(current, live, Date.now())), [live])
  const heading = thoughtTitle(live, timing.took)
  const title =
    heading.label === 'Thought for {0}' ? say(heading.label, { 0: formatDuration(heading.took) }) : say(heading.label)
  // Closed, the thought's own line says what it is; a long one also says how long it took, as on the desktop.
  // A thought still on its first paragraph has no line of its own yet, so the row says "Thinking".
  const titled = open || heading.label === 'Thought for {0}' || !line
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          setOpen((value) => !value)
        }}
        hitSlop={{ top: 4, bottom: 4 }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 4 }}
      >
        <Brain size={14} color={c.muted} />
        {titled ? (
          <T size={font.control} tone="muted" numberOfLines={1} style={{ flexShrink: 0 }}>
            {title}
          </T>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {open || !line ? null : live ? (
            <Shimmer size={font.control}>{line.slice(0, 180)}</Shimmer>
          ) : (
            <T size={font.control} tone="muted" numberOfLines={1}>
              {line}
            </T>
          )}
        </View>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        <View style={{ paddingTop: space.xs }}>
          <Markdown text={text} density="compact" muted streaming={live} />
        </View>
      </Collapse>
    </View>
  )
}
