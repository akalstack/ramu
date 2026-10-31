import { toolActivity } from '@ramu/shared/chat/toolActivity'
import { FileIcon } from './FileIcon'
import { translate } from '@ramu/shared/i18n'
import { toolVerb } from '@ramu/shared/chat/toolStatus'
import { DiffLines } from './DiffLines'
import { changedFile } from '../runtime/diff'
import { Helpers } from './Helpers'
import { InteractiveContent } from './InteractiveContent'
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActionSheetIOS, Alert, Image, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { Attachment } from '@ramu/shared/types'
import { useRouter } from 'expo-router'
import {
  Check,
  Copy,
  FileCode2,
  FilePen,
  ChevronRight,
  FileDiff,
  Flag,
  Globe,
  Lightbulb,
  Search,
  ShieldAlert,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { fill, useT, useSay } from '../i18n'
import { providerNames, type Chat, type ToolKind, type TranscriptItem } from '../runtime/types'
import { useStore } from '../runtime/store'
import { Markdown, ReferenceBadge, ReferenceContext } from './Markdown'
import { draftChip } from '@ramu/shared/chat/referenceChip'
import { composerDraft } from '@ramu/shared/chat/composerDraft'
import { useOpenFile } from '../runtime/openFile'
import { Button, Card, Chip, Sheet, T, tap, type Icon } from './ui'
import type { ElicitationField } from '@ramu/shared/types'
import { ActivityText, Arrive, Breathe, Collapse, Disclosure } from './Motion'
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

/** Called before a row expands or collapses by hand; the screen keeps its scroll position instead of following the end. */
export const RowToggle = createContext<() => void>(() => {})

/** Drops the model change waiting for the next send; set by the chat screen that holds it. */
export const CancelPendingSettings = createContext<() => void>(() => {})

/** Gives every badge in a chat the chat's file opener. */
export function ChatReferences({ chat, children }: { chat: Chat; children: ReactNode }) {
  const files = useOpenFile(chat)
  const store = useStore()
  const actions = {
    image: async (href: string) => {
      if (!chat.taskId) return null
      const file = await store.invoke(chat.computerId, 'files.resolveLink', chat.taskId, href)
      return file ? (await store.invoke(chat.computerId, 'files.media', chat.taskId, file.repoId, file.path)).url : null
    },
    openFile: (href: string) => void files.openLink(href),
    openUrl: (url: string) => void Linking.openURL(url).catch(() => {}),
  }
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
} | null>(null)

/** Long-press a message for Copy, Quote and Ask aside (the native action sheet on iOS, an alert menu on Android). */
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
  const latestMenu = useRef(menu)
  latestMenu.current = menu
  const open = () => {
    if (!text.trim()) return
    tap()
    const actions: [string, () => void][] = [
      ['Copy', () => void Clipboard.setStringAsync(text)],
      ...(menu
        ? ([
            ['Quote in reply', () => menu.quote(text)],
            ['Quote in new thread', () => menu.quoteNew(text)],
            ...(!menu.readOnly && from === 'user' && seq !== undefined
              ? ([
                  [
                    'Edit and resend',
                    () => !latestMenu.current?.readOnly && latestMenu.current?.edit(seq, text, files ?? []),
                  ],
                  ['Undo file changes from here', () => !latestMenu.current?.readOnly && latestMenu.current?.undo(seq)],
                ] as [string, () => void][])
              : []),
            ...(!menu.readOnly
              ? ([
                  [
                    'Ask aside about this',
                    () => !latestMenu.current?.readOnly && latestMenu.current?.aside(text, from),
                  ],
                ] as [string, () => void][])
              : []),
          ] as [string, () => void][])
        : []),
    ]
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...actions.map((a) => a[0]), 'Cancel'], cancelButtonIndex: actions.length },
        (index) => actions[index]?.[1](),
      )
    else
      Alert.alert('Message', undefined, [
        ...actions.map(([label, run]) => ({ text: label, onPress: run })),
        { text: 'Cancel', style: 'cancel' as const },
      ])
  }
  return (
    <Pressable
      onLongPress={open}
      delayLongPress={350}
      accessibilityHint={menu?.readOnly ? 'Long-press for Copy and Quote' : 'Long-press for Copy, Quote and Ask aside'}
    >
      {children}
    </Pressable>
  )
}

/** An image in the chat: fits the column, keeps its aspect ratio, and opens full screen when tapped. */
function ImageBlock({ uri, alt, size }: { uri: string; alt?: string; size?: number }) {
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
        accessibilityLabel={alt ?? 'Image'}
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
      <Sheet open={full} onClose={() => setFull(false)} title={alt ?? 'Image'}>
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

/** What the chat screen knows about an item's place in the conversation. */
export interface ItemMeta {
  /** A centred "Today 6:13 PM" above this message: the first one, a new day, or after a pause (the desktop's rule). */
  date?: string
  /** The last answer of its turn: shows its time and a copy button underneath. */
  footer?: boolean
  /** The reply is still arriving, so its cut-off last line is completed for display and its new words fade in. */
  streaming?: boolean
  /** The reply began while this chat was open, so its first words fade in too. */
  fresh?: boolean
}

/** A chat list row. Memoised on primitives, so streaming into the last row or scrolling doesn't re-render the other rows. */
export const TranscriptListRow = memo(function TranscriptListRow({
  item,
  chat,
  date,
  footer,
  streaming,
  fresh,
  visible,
}: {
  item: TranscriptItem
  chat: Chat
  date?: string
  footer?: boolean
  streaming: boolean
  fresh: boolean
  visible: boolean
}) {
  const meta = useMemo(() => ({ date, footer, streaming, fresh }), [date, footer, streaming, fresh])
  return (
    <Arrive animate={fresh}>
      <InteractiveVisibility.Provider value={visible}>
        <TranscriptItemView item={item} chat={chat} meta={meta} />
      </InteractiveVisibility.Provider>
    </Arrive>
  )
})

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
function AnswerFooter({ at, text }: { at?: number; text: string }) {
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
        accessibilityLabel={copied ? 'Copied' : 'Copy reply'}
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
}

function TranscriptBlock({ item, chat, meta }: { item: TranscriptItem; chat: Chat; meta?: ItemMeta }) {
  switch (item.kind) {
    case 'user':
      return (
        <MessageActions text={item.text} from="user" seq={item.seq} files={item.attachments}>
          <UserBubble text={item.text} attachments={item.attachments} chat={chat} />
        </MessageActions>
      )
    case 'text':
      return (
        <MessageActions text={item.text} from="assistant">
          <Markdown text={item.text} streaming={meta?.streaming} fresh={meta?.fresh} />
          {meta?.footer && !meta.streaming ? <AnswerFooter at={item.at} text={item.text} /> : null}
        </MessageActions>
      )
    case 'interactive':
      return <InteractiveBlock reference={item.reference} chat={chat} />
    case 'image':
      return <ImageBlock uri={item.uri} alt={item.alt} />
    case 'theme':
      return <ThemeProposal theme={item.theme} />
    case 'tool':
      return <ToolRow item={item} />
    case 'tools':
      return <ToolGroup item={item} />
    case 'plan':
      return <PlanCard item={item} />
    case 'agents':
      return <AgentsGroup item={item} chat={chat} />
    case 'question':
      return <QuestionCard item={item} chatId={chat.id} />
    case 'permission':
      return <PermissionCard item={item} chatId={chat.id} />
    case 'elicitation':
      return <ElicitationCard item={item} chatId={chat.id} />
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
      return <NoteRow item={item} chat={chat} />
    case 'end':
      return null
  }
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
              Alert.alert('Could not switch back', error instanceof Error ? error.message : String(error)),
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
  let title = item.goalNote ? (strings.goalNotes[item.goalNote] ?? item.title) : item.title
  if (item.title === 'Background command stop requested') title = translate(store.language, item.title)
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
    const others = (
      before
        ? ([[ACCESS[before.access], ACCESS[next.access]]] as const)
            .filter(([a, b]) => a !== b)
            .map(([a, b]) => `${a} → ${b}`)
        : [ACCESS[next.access]]
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
            {item.detail}
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
              {item.previous ? `Cancel · stay on ${label(item.previous)}` : 'Cancel'}
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
                ? 'Switching back…'
                : `Switch back to ${item.previous ? label(item.previous) : 'previous model'}`}
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
        <T size={font.control} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {label}
        </T>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        <View style={{ gap: space.m, paddingLeft: space.s, borderLeftWidth: 1, borderLeftColor: c.line }}>
          {children}
        </View>
      </Collapse>
    </View>
  )
}

function UserBubble({ text, attachments, chat }: { text: string; attachments?: Attachment[]; chat: Chat }) {
  const { c } = useTheme()
  const actions = useContext(ReferenceContext)
  const segments = composerDraft(text + ' ').segments
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
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '86%', gap: space.s, alignItems: 'flex-end' }}>
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
          {hasText ? (
            <T tone="text" style={{ lineHeight: 21 }}>
              {body}
            </T>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function ToolGroup({ item }: { item: Extract<TranscriptItem, { kind: 'tools' }> }) {
  const { c } = useTheme()
  const { language } = useStore()
  const [open, setOpen] = useState(false)
  const toggled = useContext(RowToggle)
  const { current, running, failed } = toolActivity(item.tools, (tool) =>
    tool.status === 'in_progress' ? 'running' : tool.status === 'failed' ? 'failed' : 'done',
  )
  const counts = new Map<string, number>()
  for (const tool of item.tools) counts.set(tool.verb, (counts.get(tool.verb) ?? 0) + 1)
  const headline =
    running || failed
      ? `${current?.verb ?? ''} ${current?.subject ?? ''}`.trim()
      : [...counts].map(([verb, count]) => `${verb}${count > 1 ? ` ×${count}` : ''}`).join(' · ')
  const Icon = current ? toolIcons[current.tool] : Wrench
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
        <Breathe active={running > 0}>
          <Icon size={14} color={failed ? c.bad : running ? c.accent : c.muted} />
        </Breathe>
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* The headline follows the current tool; each change fades instead of jumping. */}
          <Arrive animate={false} identity={headline}>
            <ActivityText active={running > 0}>{headline}</ActivityText>
          </Arrive>
        </View>
        {failed > 0 ? (
          <T size={font.caption} tone="bad">
            {language === 'id' ? 'Gagal' : 'Failed'} · {failed}
          </T>
        ) : null}
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        <View style={{ paddingLeft: space.s, borderLeftWidth: 1, borderLeftColor: c.line, gap: space.xs }}>
          {item.tools.map((tool) => (
            <Arrive key={tool.id} animate={!initial.has(tool.id)}>
              <ToolRow item={tool} />
            </Arrive>
          ))}
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
  const openable = Boolean(item.detail || item.input || diffs.length || item.file)
  const I = toolIcons[item.tool]
  // A log is cropped to a few lines inline; the whole thing opens in a sheet (a bottom sheet on iOS and Android alike).
  const PREVIEW_LINES = 6
  const lines = item.detail ? item.detail.split('\n').length : 0
  const long = Boolean(item.detail) && (lines > PREVIEW_LINES || item.detail!.length > 400)
  const running = item.status === 'in_progress'
  const failed = item.status === 'failed'
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
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 3 }}
      >
        <Breathe active={running}>
          <I size={14} color={failed ? c.bad : running ? c.accent : c.muted} strokeWidth={1.8} />
        </Breathe>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ActivityText
            active={running}
          >{`${item.file ? translate(storeLanguage, toolVerb(item.verb, running)) : item.verb} ${item.subject}`}</ActivityText>
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
            {storeLanguage === 'id' ? 'Gagal' : 'Failed'}
          </T>
        ) : null}
        {openable ? <Disclosure open={open} size={13} color={c.placeholder} /> : null}
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
            style={{ marginLeft: 22, marginTop: 2, flexDirection: 'row', gap: space.s, alignItems: 'center' }}
          >
            <T size={font.caption} mono tone="muted" numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 1 }}>
              {filePath}
            </T>
            <T size={font.caption} weight="600" tone="accent">
              {translate(storeLanguage, 'Open file')}
            </T>
          </Pressable>
        ) : null}
        {diffs.map((diff, index) => (
          <View key={index} style={{ marginLeft: 22, marginTop: 4 }}>
            <DiffLines file={changedFile(diff.path, '', diff.oldText ?? '', diff.newText)} />
          </View>
        ))}
        {!diffs.length || failed ? (
          <View
            style={{
              marginLeft: 22,
              marginTop: 4,
              padding: space.s + 2,
              backgroundColor: c.code,
              borderRadius: radius.s,
            }}
          >
            {item.input ? (
              <View style={{ gap: space.xs, marginBottom: item.detail ? space.s : 0 }}>
                <T size={font.caption} weight="600" tone="muted">
                  {storeLanguage === 'id' ? 'Masukan' : 'Input'}
                </T>
                <T size={font.caption} mono copyable={item.input}>
                  {item.input}
                </T>
              </View>
            ) : null}
            <T size={font.caption} weight="600" tone="muted">
              {storeLanguage === 'id' ? 'Keluaran' : 'Output'}
            </T>
            <T
              size={font.caption}
              mono
              tone={failed ? 'bad' : 'soft'}
              numberOfLines={PREVIEW_LINES}
              ellipsizeMode="tail"
            >
              {item.detail ||
                (running
                  ? storeLanguage === 'id'
                    ? 'Berjalan…'
                    : 'Running…'
                  : storeLanguage === 'id'
                    ? 'Tidak ada keluaran'
                    : 'No output')}
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
                  Show full log
                </T>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Collapse>
      {item.detail ? (
        <Sheet open={full} onClose={() => setFull(false)} title={`${item.verb} ${item.subject}`.trim()}>
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
  const { decide } = useStore()
  if (item.decision) {
    const allowed = item.decision === 'allow'
    return (
      <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
        {allowed ? <Check size={14} color={c.ok} /> : <X size={14} color={c.bad} />}
        <T size={font.control} tone="muted" mono numberOfLines={1} style={{ flex: 1 }}>
          {allowed ? 'Allowed' : 'Denied'} · {item.command}
        </T>
      </View>
    )
  }
  return (
    <Card style={{ padding: space.m, gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <ShieldAlert size={16} color={c.warn} strokeWidth={1.8} />
        <T size={font.body} weight="600">
          {item.title}
        </T>
      </View>
      <View style={{ backgroundColor: c.code, borderRadius: radius.s, padding: space.m }}>
        <T size={font.caption + 1} mono tone="soft">
          {item.command}
        </T>
      </View>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          kind="secondary"
          title={say('Deny')}
          style={{ flex: 1 }}
          onPress={() => decide(chatId, item.id, 'deny')}
        />
        <Button title={say('Allow once')} style={{ flex: 1 }} onPress={() => decide(chatId, item.id, 'allow')} />
      </View>
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
  chat,
}: {
  reference: import('@ramu/shared/interactive').InteractiveReference
  chat: Chat
}) {
  const menu = useContext(MessageMenu)
  return (
    <InteractiveContent
      key={`${reference.id}:${reference.version}`}
      reference={reference}
      chat={chat}
      onAsk={(text) => menu?.quote(text)}
    />
  )
}
