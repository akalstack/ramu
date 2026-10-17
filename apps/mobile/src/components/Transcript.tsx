import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { ActionSheetIOS, Alert, Image, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { Attachment } from '@ramu/shared/types'
import { useRouter } from 'expo-router'
import {
  Bot,
  Check,
  Copy,
  ChevronRight,
  FileCode2,
  FilePen,
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
import { providerNames, type Chat, type ToolKind, type TranscriptItem } from '../runtime/types'
import { useStore } from '../runtime/store'
import { Markdown, ReferenceBadge, ReferenceContext } from './Markdown'
import { draftChip } from '@ramu/shared/chat/referenceChip'
import { composerDraft } from '@ramu/shared/chat/composerDraft'
import { useOpenFile } from '../runtime/openFile'
import { Button, Card, Divider, Sheet, T, tap, type Icon } from './ui'
import { formatDuration } from '../runtime/turns'
import { Breathe, Disclosure, animateLayout } from './Motion'

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
  const open = () => {
    if (!text.trim()) return
    tap()
    const actions: [string, () => void][] = [
      ['Copy', () => void Clipboard.setStringAsync(text)],
      ...(menu
        ? ([
            ['Quote in reply', () => menu.quote(text)],
            ['Quote in new thread', () => menu.quoteNew(text)],
            ...(from === 'user' && seq !== undefined
              ? ([
                  ['Edit and resend', () => menu.edit(seq, text, files ?? [])],
                  ['Undo file changes from here', () => menu.undo(seq)],
                ] as [string, () => void][])
              : []),
            ['Ask aside about this', () => menu.aside(text, from)],
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
    <Pressable onLongPress={open} delayLongPress={350} accessibilityHint="Long-press for Copy, Quote and Ask aside">
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
        <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', aspectRatio: ratio, maxHeight: 520 }} />
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
    case 'image':
      return <ImageBlock uri={item.uri} alt={item.alt} />
    case 'tool':
      return <ToolRow item={item} />
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
    case 'working':
      return <WorkingRule since={item.since} />
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
  const { c } = useTheme()
  const store = useStore()
  const [undoing, setUndoing] = useState(false)
  // As on the desktop: a settings change can be undone, restoring the previous settings for the next message.
  const undo =
    item.previous && chat.sessionId
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
  let title = item.title
  if (item.settings) {
    const next = item.settings,
      before = item.previous
    const changes = before
      ? (
          [
            [label(before), label(next)],
            [ACCESS[before.access], ACCESS[next.access]],
          ] as const
        )
          .filter(([a, b]) => a !== b)
          .map(([a, b]) => `${a} → ${b}`)
      : []
    title = changes.length ? changes.join(' · ') : before ? label(next) : [label(next), ACCESS[next.access]].join(' · ')
  }
  return (
    <View
      accessible
      accessibilityRole="text"
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, marginVertical: space.s }}
    >
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.lineStrong }} />
      <View style={{ maxWidth: '78%', alignItems: 'center', gap: 2 }}>
        <T size={font.caption} tone={item.failed ? 'bad' : 'muted'} style={{ textAlign: 'center' }}>
          {title}
        </T>
        {item.detail ? (
          <T size={font.caption} tone="placeholder" style={{ textAlign: 'center' }}>
            {item.detail}
          </T>
        ) : null}
        {undo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch back to the previous model and settings"
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

/** Live "Working for 12s" above the running turn's steps. */
function WorkingRule({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <T size={font.control} tone="muted" accessibilityRole="text" style={{ fontVariant: ['tabular-nums'] }}>
      {since ? `Working for ${formatDuration(Math.max(0, now - since))}` : 'Working'}
    </T>
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
          animateLayout()
          setOpen((o) => !o)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 }}
      >
        <T size={font.control} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {label}
        </T>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      {open ? (
        <View style={{ gap: space.m, paddingLeft: space.s, borderLeftWidth: 1, borderLeftColor: c.line }}>
          {children}
        </View>
      ) : null}
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

function ToolRow({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const toggled = useContext(RowToggle)
  const references = useContext(ReferenceContext)
  // Reads and edits name a file; tapping it opens that file like the desktop's tool rows do.
  const filePath =
    item.tool === 'read' || item.tool === 'edit'
      ? item.subject.match(/[\w@~./-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?/)?.[0]
      : undefined
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
        disabled={!item.detail}
        onPress={() => {
          tap()
          toggled()
          animateLayout()
          setOpen((o) => !o)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 3 }}
      >
        <Breathe active={running}>
          <I size={14} color={failed ? c.bad : running ? c.accent : c.muted} strokeWidth={1.8} />
        </Breathe>
        <T size={font.control} tone={running ? 'soft' : 'muted'} weight="500">
          {item.verb}
        </T>
        <T
          size={font.control}
          tone={failed ? 'bad' : 'muted'}
          mono={item.tool !== 'search' && item.tool !== 'fetch'}
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {item.subject}
        </T>
        {item.detail ? <Disclosure open={open} size={13} color={c.placeholder} /> : null}
      </Pressable>
      {filePath ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${filePath}`}
          onPress={() => {
            tap()
            references.openFile(filePath)
          }}
          hitSlop={6}
          style={{ marginLeft: 22, alignSelf: 'flex-start', paddingVertical: 2 }}
        >
          <T size={font.caption} weight="600" tone="accent">
            Open file
          </T>
        </Pressable>
      ) : null}
      {open && item.detail ? (
        <View
          style={{
            marginLeft: 22,
            marginTop: 4,
            padding: space.s + 2,
            backgroundColor: c.code,
            borderRadius: radius.s,
          }}
        >
          <T size={font.caption} mono tone={failed ? 'bad' : 'soft'} numberOfLines={PREVIEW_LINES} ellipsizeMode="tail">
            {item.detail}
          </T>
          {long ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show full log"
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
      {item.detail ? (
        <Sheet open={full} onClose={() => setFull(false)} title={`${item.verb} ${item.subject}`.trim()}>
          <View style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
            <T
              size={font.caption}
              mono
              copyable={item.detail}
              tone={failed ? 'bad' : 'soft'}
              style={{ lineHeight: 17 }}
            >
              {item.detail}
            </T>
          </View>
        </Sheet>
      ) : null}
    </View>
  )
}

function AgentsGroup({ item, chat }: { item: Extract<TranscriptItem, { kind: 'agents' }>; chat: Chat }) {
  const { c } = useTheme()
  const store = useStore()
  const [shownId, setShownId] = useState<string | null>(null)
  const [relay, setRelay] = useState('')
  const shown = item.agents.find((a) => a.id === shownId)
  const stop = (agentId: string) =>
    chat.sessionId &&
    Alert.alert('Stop this sub-agent?', 'The main thread keeps going.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: () =>
          void store
            .invoke(chat.computerId, 'agent.stopTask', chat.sessionId!, agentId)
            .catch((error) => Alert.alert('Could not stop', error instanceof Error ? error.message : String(error))),
      },
    ])
  const [open, setOpen] = useState(true)
  const toggled = useContext(RowToggle)
  const done = item.agents.filter((a) => a.status !== 'running').length
  return (
    <Card>
      <Pressable
        onPress={() => {
          tap()
          toggled()
          animateLayout()
          setOpen((o) => !o)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, padding: space.m }}
      >
        <Bot size={15} color={c.soft} strokeWidth={1.8} />
        <T size={font.control} weight="600" style={{ flex: 1 }}>
          {item.agents.length} agents
        </T>
        <T size={font.caption} tone="muted">
          {done}/{item.agents.length} done
        </T>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      {open
        ? item.agents.map((a, i) => (
            <View key={a.id ?? i}>
              <Divider inset={space.m} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${a.name}, ${a.status}. Show details`}
                onPress={() => {
                  tap()
                  setShownId(a.id)
                }}
                style={({ pressed }) => ({
                  padding: space.m,
                  gap: 3,
                  backgroundColor: pressed ? c.pressed : 'transparent',
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: a.status === 'running' ? c.accent : a.status === 'failed' ? c.bad : c.ok,
                    }}
                  />
                  <T size={font.control} weight="500" style={{ flex: 1 }} numberOfLines={1}>
                    {a.name}
                  </T>
                  <T size={font.caption} tone="muted">
                    {a.type}
                  </T>
                </View>
                <T size={font.caption + 1} tone="muted" numberOfLines={2} style={{ marginLeft: 14, lineHeight: 18 }}>
                  {a.summary}
                </T>
              </Pressable>
            </View>
          ))
        : null}
      <Sheet open={Boolean(shown)} onClose={() => setShownId(null)} title={shown?.name ?? 'Sub-agent'}>
        {shown ? (
          <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.m }}>
            <T size={font.caption} tone="muted">
              {[
                shown.type,
                shown.status === 'running' ? 'Working' : shown.status === 'failed' ? 'Stopped or failed' : 'Finished',
              ]
                .filter(Boolean)
                .join(' · ')}
            </T>
            {shown.prompt ? (
              <View style={{ gap: 4 }}>
                <T size={font.caption} weight="600" tone="muted">
                  TASK
                </T>
                <T size={font.control} tone="soft" copyable={shown.prompt}>
                  {shown.prompt}
                </T>
              </View>
            ) : null}
            {shown.log ? (
              <View style={{ gap: 4 }}>
                <T size={font.caption} weight="600" tone="muted">
                  ITS OUTPUT
                </T>
                <Markdown text={shown.log.slice(-6000)} />
              </View>
            ) : null}
            <View style={{ gap: 4 }}>
              <T size={font.caption} weight="600" tone="muted">
                {shown.status === 'running' ? 'PROGRESS' : 'REPORT'}
              </T>
              {shown.summary ? <Markdown text={shown.summary} /> : <T tone="muted">Nothing reported yet.</T>}
            </View>
            {chat.sessionId && shown.status === 'running' ? (
              <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'flex-end' }}>
                <TextInput
                  value={relay}
                  onChangeText={setRelay}
                  multiline
                  placeholder={`Message ${shown.name}`}
                  placeholderTextColor={c.placeholder}
                  style={{
                    flex: 1,
                    maxHeight: 100,
                    minHeight: 40,
                    padding: space.m,
                    color: c.text,
                    backgroundColor: c.fill,
                    borderRadius: radius.m,
                  }}
                />
                <Button
                  title="Send"
                  disabled={!relay.trim()}
                  onPress={() => {
                    const text = relay.trim()
                    setRelay('')
                    void store
                      .invoke(chat.computerId, 'agent.messageTask', chat.sessionId!, shown.id, text)
                      .catch((error) =>
                        Alert.alert('Could not send', error instanceof Error ? error.message : String(error)),
                      )
                  }}
                />
              </View>
            ) : null}
            {shown.status === 'running' && chat.sessionId ? (
              <Button kind="danger" title="Stop sub-agent" onPress={() => stop(shown.id)} />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Card>
  )
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
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={() => {
        tap()
        onPress()
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
        {selected ? <Check size={11} color="#fff" strokeWidth={3} /> : null}
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

function QuestionCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'question' }>; chatId: string }) {
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
  }, [draftKey, picked, other])
  if (item.answers) {
    return (
      <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
        <Check size={14} color={c.ok} />
        <T size={font.control} tone="muted" style={{ flex: 1 }} numberOfLines={2}>
          Answered: {Object.values(item.answers).join(' · ')}
        </T>
      </View>
    )
  }
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
        <View key={q.question} style={{ gap: space.s }}>
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
                onPress={() =>
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
                }
              />
            )
          })}
          <TextInput
            placeholder="Other answer…"
            placeholderTextColor={c.placeholder}
            value={other[q.id ?? q.question] ?? ''}
            onChangeText={(v) => setOther((o) => ({ ...o, [q.id ?? q.question]: v }))}
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
        <Button kind="ghost" title="Dismiss" onPress={() => answer(chatId, item.id, { _: 'Dismissed' })} />
        <Button
          title="Submit"
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
        <Button kind="secondary" title="Deny" style={{ flex: 1 }} onPress={() => decide(chatId, item.id, 'deny')} />
        <Button title="Allow once" style={{ flex: 1 }} onPress={() => decide(chatId, item.id, 'allow')} />
      </View>
    </Card>
  )
}

function ChangesCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'changes' }>; chatId: string }) {
  const { c } = useTheme()
  const router = useRouter()
  return (
    <Pressable
      onPress={() => {
        tap()
        router.push({ pathname: '/chat/[id]/changes', params: { id: chatId } })
      }}
    >
      {({ pressed }) => (
        <Card
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.m,
            padding: space.m,
            opacity: pressed ? 0.8 : 1,
          }}
        >
          <FilePen size={16} color={c.soft} strokeWidth={1.8} />
          <T size={font.body - 1} weight="500" style={{ flex: 1 }}>
            {item.files} files changed
          </T>
          <T size={font.control} mono tone="ok">
            +{item.additions}
          </T>
          <T size={font.control} mono tone="bad">
            −{item.deletions}
          </T>
          <ChevronRight size={16} color={c.muted} />
        </Card>
      )}
    </Pressable>
  )
}

function GoalDone({ item }: { item: Extract<TranscriptItem, { kind: 'goal' }> }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <Flag size={14} color={c.ok} strokeWidth={1.8} />
      <T size={font.control} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        Goal reached in {item.turns} turns · {item.objective}
      </T>
    </View>
  )
}

function ElicitationCard({ item, chatId }: { item: Extract<TranscriptItem, { kind: 'elicitation' }>; chatId: string }) {
  const { c } = useTheme()
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
          title="Open request"
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
          <T size={font.caption} tone="muted">
            {f.description || (f.options.length ? f.options.map((o) => `${o.label}: ${o.value}`).join(', ') : f.type)}
          </T>
          <TextInput
            value={answers[f.id] ?? ''}
            onChangeText={(v) => setAnswers((old) => ({ ...old, [f.id]: v }))}
            style={{ color: c.text, backgroundColor: c.fill, padding: space.m }}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button kind="secondary" title="Decline" onPress={() => elicitation(chatId, item.id, 'decline', {})} />
        <Button
          title="Submit"
          disabled={item.request.fields.some((f) => f.required && !answers[f.id]?.trim())}
          onPress={() => elicitation(chatId, item.id, 'accept', answers)}
        />
      </View>
    </Card>
  )
}
