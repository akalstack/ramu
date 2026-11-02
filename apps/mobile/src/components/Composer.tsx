import { isModelListed } from '@ramu/shared/providers/modelVisibility'
import { SheetFlatList as FlatList } from './ui'
import { REFERENCE_APPEARANCE } from '@ramu/shared/chat/presentation'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { composerDraft } from '@ramu/shared/chat/composerDraft'
import { fileContextKey } from '@ramu/shared/chat/fileContext'
import { SuggestionList, useComposerSuggest } from './ComposerSuggest'
import {
  ArrowUp,
  Pencil,
  ChevronLeft,
  ChevronRight,
  FileText,
  Paperclip,
  Check,
  ChevronDown,
  Clock,
  CornerDownRight,
  Flag,
  ListPlus,
  Pause,
  Play,
  Plus,
  Quote,
  ShieldCheck,
  Square,
  X,
  Camera,
  Image as ImageIcon,
  SlidersHorizontal,
  Sparkles,
  LockOpen,
  Shuffle,
  Zap,
} from 'lucide-react-native'
import type { AgentProvider, AgentSettings, ChatGoal, FileContext, QueuedMessage, SkillInfo } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { providerNames } from '../runtime/types'
import { useStore } from '../runtime/store'
import { BUSY_MODE_DEVICE_KEY, otherBusyMode, resolveBusyMode } from '../runtime/busyMode'
import { sharedValue } from '@ramu/shared/sharedFields'
import { useModelFlow } from '../runtime/useModelFlow'
import { fill, useT, useSay } from '../i18n'
import { translate } from '@ramu/shared/i18n'
import { Chip, IconButton, Row, Segmented, Sheet, T, Toggle, tap, type Icon } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

const ACCESS_MODES = [
  { key: 'edits', label: 'Allow edits', help: 'File edits go through; commands still ask first.', icon: Pencil },
  {
    key: 'auto',
    label: 'Auto',
    help: 'Routine actions are approved for you where the provider supports it; the rest still ask.',
    icon: Sparkles,
  },
  { key: 'full', label: 'Full access', help: 'Commands and edits run without asking.', icon: LockOpen },
] as const
import { ProviderIcon } from './Logos'
import { Glass } from './Glass'
import { AutoResumeRows, LimitTray } from './LimitTray'
import { canEditVerify } from '../runtime/goalVerify'
import { isUserPaused } from '@ramu/shared/chat/goalHold'
import { GoalVerifySheet } from './GoalVerifySheet'
import { BottomSearch } from './BottomSearch'
import { DictationStatus, MicButton } from './DictationControls'
import { dictationBusy } from '@ramu/shared/voice/dictation'
import {
  prepareVoiceModel,
  useDictation,
  useMicControl,
  useVoiceCapability,
  useVoiceSettings,
} from '../runtime/useDictation'

export interface ModelChoice {
  provider: AgentProvider
  model: string
  effort: string
  settings?: Pick<AgentSettings, 'access' | 'autoFallback' | 'serviceTier' | 'accountId'>
}

export function modelLabel(m: ModelChoice) {
  return m.model || providerNames[m.provider]
}

/** Rows an iOS model list draws at a time; the native sheet scrolls them. */
const MODEL_PAGE = 60
/** Models each provider shows on the picker's first page before "All N models". */
const MODELS_PER_PROVIDER = 4
/** An effort level as people read it. */
const effortWord = (effort: string) =>
  effort === 'xhigh' ? 'Extra high' : effort ? effort[0]!.toUpperCase() + effort.slice(1) : ''

type ModelRow = {
  provider: AgentProvider
  model: string
  label: string
  efforts: string[]
  isDefault: boolean
  defaultEffort: string
}

/**
 * The model picker is three small steps so it never has to draw hundreds of rows at once (OpenCode lists very many):
 * providers, then that provider's models in a searchable virtualized list, then the reasoning effort. Choosing an effort closes it.
 */
export function ModelChip({
  value,
  onChange,
  computerId,
  limited,
}: {
  value: ModelChoice
  /** The thread is held at this provider's usage limit: the chip carries a small "Limit reached" marker. */
  limited?: boolean
  onChange: (m: ModelChoice) => void
  computerId?: string
}) {
  const store = useStore()
  const t = useT()
  const catalog = store.catalogs[computerId ?? store.selected]
  const visible = store.appPreferences[computerId ?? store.selected]?.visibleModels
  const models = useMemo<ModelRow[]>(
    () =>
      (catalog ?? []).flatMap((p) =>
        p.models
          .filter((m) => {
            const inUse = p.provider === value.provider && (m.id === value.model || (!value.model && m.isDefault))
            return inUse || isModelListed(visible, { provider: p.provider, id: m.id })
          })
          .map((m) => ({
            provider: p.provider,
            model: m.id,
            label: m.name,
            efforts: m.efforts as string[],
            isDefault: m.isDefault,
            defaultEffort: (m.defaultEffort ?? '') as string,
          })),
      ),
    [catalog, visible, value.provider, value.model],
  )
  const providers = useMemo(
    () =>
      (Object.keys(providerNames) as AgentProvider[])
        .map((p) => ({ provider: p, count: models.filter((m) => m.provider === p).length }))
        .filter((p) => p.count),
    [models],
  )
  const { c } = useTheme()
  const { height: windowHeight } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<AgentProvider | null>(null)
  const [picking, setPicking] = useState<ModelRow | null>(null)
  const [query, setQuery] = useState('')
  // An empty model means "the provider's default": show which model that is rather than just the provider.
  const current =
    models.find((m) => m.provider === value.provider && m.model === value.model) ??
    (value.model ? undefined : models.find((m) => m.provider === value.provider && m.isDefault))
  const label = current?.label ?? modelLabel(value)
  const effort = value.effort || current?.defaultEffort || ''
  const close = () => {
    setOpen(false)
    setPicking(null)
    setProvider(null)
    setQuery('')
  }
  const commit = (m: ModelRow, chosen: string) => {
    onChange({ settings: value.settings, provider: m.provider, model: m.model, effort: chosen })
    close()
  }
  const shown = useMemo(() => {
    if (!provider) return []
    const needle = query.trim().toLowerCase()
    return models.filter(
      (m) => m.provider === provider && (!needle || `${m.label} ${m.model}`.toLowerCase().includes(needle)),
    )
  }, [models, provider, query])
  const title = picking ? picking.label : provider ? providerNames[provider] : 'Model'
  const back = picking
    ? () => setPicking(null)
    : provider
      ? () => {
          setProvider(null)
          setQuery('')
        }
      : undefined
  const offline = !store.isOnline(computerId ?? store.selected)
  const providerCount = provider ? models.filter((m) => m.provider === provider).length : 0
  const searchProps =
    provider && !picking && providerCount > 8
      ? { value: query, onChangeText: setQuery, placeholder: `Search ${providerCount} models` }
      : undefined
  const [limit, setLimit] = useState(MODEL_PAGE)
  useEffect(() => setLimit(MODEL_PAGE), [provider, query])
  const modelRow = (m: ModelRow) => {
    const selected = current?.provider === m.provider && current.model === m.model
    return (
      <Row
        key={`${m.provider}:${m.model}`}
        onPress={() => {
          tap()
          if (m.efforts.length > 1) setPicking(m)
          else commit(m, m.efforts[0] ?? '')
        }}
      >
        <View style={{ flex: 1 }}>
          <T weight={selected ? '600' : '400'} numberOfLines={1}>
            {m.label}
          </T>
          <T size={font.caption} tone="muted" mono numberOfLines={1}>
            {m.model}
          </T>
        </View>
        {selected ? (
          <Check size={17} color={c.accent} />
        ) : m.efforts.length > 1 ? (
          <ChevronRight size={15} color={c.placeholder} />
        ) : null}
      </Row>
    )
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Model: ${label}${effort ? `, ${effort}` : ''}`}
        onPress={() => {
          tap()
          setPicking(null)
          setProvider(null)
          setQuery('')
          setOpen(true)
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          height: 34,
          paddingHorizontal: space.m - 2,
          borderRadius: radius.full,
          backgroundColor: pressed ? c.pressed : 'transparent',
        })}
      >
        <ProviderIcon provider={value.provider} size={14} />
        <T size={font.control} weight="500" tone="soft" numberOfLines={1} style={{ marginLeft: 2, maxWidth: 140 }}>
          {label}
        </T>
        {effort ? (
          <T size={font.control} tone="muted">
            {effort}
          </T>
        ) : null}
        {limited ? (
          <T size={font.caption} weight="600" tone="warn" numberOfLines={1}>
            {t.limitReached}
          </T>
        ) : null}
        <ChevronDown size={13} color={c.muted} />
      </Pressable>
      <Sheet
        open={open}
        onClose={close}
        title={title}
        scroll={Platform.OS === 'ios'}
        // On iOS a search bar added mid-flow rebuilds the native sheet and its rows stop taking taps, so iOS searches
        // inside the list instead.
        search={Platform.OS !== 'ios' && searchProps ? searchProps : undefined}
      >
        {back ? (
          <Row onPress={back}>
            <ChevronLeft size={18} color={c.soft} />
            <T tone="soft">{picking ? 'Back to models' : 'All providers'}</T>
          </Row>
        ) : null}
        {picking ? (
          <View>
            <T
              size={font.caption}
              weight="600"
              tone="muted"
              style={{
                paddingHorizontal: space.l,
                paddingTop: space.s,
                paddingBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}
            >
              Reasoning effort
            </T>
            {picking.efforts.map((e) => {
              const selected =
                picking.provider === value.provider && picking.model === value.model
                  ? e === value.effort
                  : e === picking.defaultEffort
              return (
                <Row key={e} onPress={() => commit(picking, e)}>
                  <T style={{ flex: 1, textTransform: 'capitalize' }} weight={selected ? '600' : '400'}>
                    {e}
                    {e === picking.defaultEffort ? '  · default' : ''}
                  </T>
                  {selected ? <Check size={17} color={c.accent} /> : null}
                </Row>
              )
            })}
          </View>
        ) : provider ? (
          Platform.OS === 'ios' ? (
            // iOS sheets are native: a React Native list inside one swallows taps, so the sheet scrolls plain rows.
            <View>
              {searchProps ? <BottomSearch {...searchProps} inputOnly /> : null}
              {shown.slice(0, limit).map(modelRow)}
              {shown.length > limit ? (
                <Row onPress={() => setLimit((value) => value + MODEL_PAGE)}>
                  <T tone="accent" weight="500">
                    {`Show ${Math.min(MODEL_PAGE, shown.length - limit)} more of ${shown.length - limit}`}
                  </T>
                </Row>
              ) : null}
              {!shown.length ? (
                <T tone="muted" style={{ padding: space.l }}>
                  No model matches.
                </T>
              ) : null}
            </View>
          ) : (
            <View style={{ flexShrink: 1 }}>
              {/* Its own virtualized list, so only the rows on screen are drawn; it grows with its rows up to most of the screen. */}
              <FlatList
                style={{ flexGrow: 0, maxHeight: Math.round(windowHeight * 0.7) }}
                data={shown}
                keyExtractor={(m) => `${m.provider}:${m.model}`}
                initialNumToRender={12}
                maxToRenderPerBatch={10}
                windowSize={5}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                ListEmptyComponent={
                  <T tone="muted" style={{ padding: space.l }}>
                    No model matches.
                  </T>
                }
                renderItem={({ item }) => modelRow(item)}
              />
            </View>
          )
        ) : (
          <View>
            <QuickSteps
              value={value}
              models={models}
              prefs={store.modelPrefs[computerId ?? store.selected]}
              computerId={computerId ?? store.selected}
              onChange={(choice) => {
                onChange(choice)
                close()
              }}
            />
            {/* Models straight away, as on the desktop: each provider's first few, with the rest one tap further. */}
            {providers.map((p) => {
              const own = models.filter((m) => m.provider === p.provider)
              const first = [
                ...own.filter((m) => m.provider === current?.provider && m.model === current.model),
                ...own.filter((m) => !(m.provider === current?.provider && m.model === current.model)),
              ].slice(0, MODELS_PER_PROVIDER)
              return (
                <View key={p.provider}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.s,
                      paddingHorizontal: space.l,
                      paddingTop: space.m,
                      paddingBottom: 2,
                    }}
                  >
                    <ProviderIcon provider={p.provider} size={14} />
                    <T
                      size={font.caption}
                      weight="600"
                      tone="muted"
                      style={{ textTransform: 'uppercase', letterSpacing: 0.3 }}
                    >
                      {providerNames[p.provider]}
                    </T>
                  </View>
                  {first.map(modelRow)}
                  {own.length > first.length ? (
                    <Row
                      onPress={() => {
                        tap()
                        setProvider(p.provider)
                        setQuery('')
                      }}
                    >
                      <T tone="accent" weight="500" style={{ flex: 1 }}>
                        {`All ${own.length} ${providerNames[p.provider]} models`}
                      </T>
                      <ChevronRight size={15} color={c.placeholder} />
                    </Row>
                  ) : null}
                </View>
              )
            })}
            {!providers.length ? (
              <T tone="muted" style={{ padding: space.l }}>
                {offline ? 'Reconnect this host to choose a model.' : 'No models reported by this host yet.'}
              </T>
            ) : null}
          </View>
        )}
      </Sheet>
    </>
  )
}

/** Tray rows at the top of the composer: the live goal first, then queued and steering messages. */
export function GoalQueueTray({
  goal,
  queue,
  paused: queuePaused,
  onResumeQueue,
  onToggleGoal,
  onClearGoal,
  onVerifyGoal,
  verifyOffered,
  onRemove,
}: {
  goal: ChatGoal | null
  queue: QueuedMessage[]
  paused?: boolean
  onResumeQueue?: () => void
  onToggleGoal?: () => void
  onClearGoal?: () => void
  /** Sets the goal's verification command, or removes it with null; rejects with the host's reason. */
  onVerifyGoal?: (command: string | null) => Promise<void>
  /** False once the host has shown it cannot do this: the button goes, an open sheet stays to say why. */
  verifyOffered?: boolean
  onRemove?: (id: string) => void
}) {
  const say = useSay()
  const { c } = useTheme()
  const t = useT()
  const [verifying, setVerifying] = useState(false)
  if (!goal && !queue.length) return null
  // Only a goal the user paused reads as paused here; one held by a usage limit continues by itself and shows in the limit tray.
  const paused = isUserPaused(goal)
  return (
    <View
      style={{
        paddingHorizontal: space.m,
        paddingTop: 4,
        paddingBottom: 2,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.lineStrong,
      }}
    >
      {goal ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}>
          <Flag size={14} color={paused ? c.muted : c.accent} strokeWidth={1.8} />
          <T size={font.control} tone={paused ? 'muted' : 'soft'} numberOfLines={1} style={{ flex: 1 }}>
            {goal.objective}
          </T>
          <T size={font.caption} tone="muted">
            {paused ? 'paused' : `turn ${goal.turns}`}
          </T>
          {onVerifyGoal && verifyOffered ? (
            <IconButton
              icon={ShieldCheck}
              label={goal.verify ? t.verifyEdit : t.verifySet}
              size={28}
              tone={goal.verify ? 'accent' : 'muted'}
              onPress={() => setVerifying(true)}
            />
          ) : null}
          <IconButton
            icon={paused ? Play : Pause}
            label={paused ? 'Resume goal' : 'Pause goal'}
            size={28}
            tone="muted"
            onPress={onToggleGoal}
          />
          <IconButton icon={X} label={say('Clear goal')} size={28} tone="muted" onPress={onClearGoal} />
        </View>
      ) : null}
      {goal && onVerifyGoal ? (
        <GoalVerifySheet open={verifying} goal={goal} onClose={() => setVerifying(false)} onSave={onVerifyGoal} />
      ) : null}
      {queuePaused && queue.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}>
          <Pause size={14} color={c.warn} strokeWidth={1.8} />
          <T size={font.control} tone="warn" style={{ flex: 1 }}>
            Queue paused
          </T>
          {onResumeQueue ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                tap()
                onResumeQueue()
              }}
              hitSlop={6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: space.s,
                height: 28,
                borderRadius: radius.full,
                backgroundColor: c.fill,
              }}
            >
              <Play size={12} color={c.soft} />
              <T size={font.caption} weight="600" tone="soft">
                Resume
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {queue.map((q) => (
        <View key={q.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}>
          {q.mode === 'steer' ? (
            <CornerDownRight size={14} color={c.warn} strokeWidth={1.8} />
          ) : (
            <ListPlus size={14} color={c.muted} strokeWidth={1.8} />
          )}
          <T size={font.control} tone="soft" numberOfLines={1} style={{ flex: 1 }}>
            {q.text}
          </T>
          <T size={font.caption} tone="muted">
            {q.mode === 'steer' ? t.steer : t.queued}
          </T>
          <IconButton icon={X} label={say('Remove')} size={28} tone="muted" onPress={() => onRemove?.(q.id)} />
        </View>
      ))}
    </View>
  )
}

/** How long a closing sheet takes to leave the screen before a picker or another sheet can open. */
const SHEET_SETTLE_MS = 400

export function Composer({
  running,
  model,
  onModel,
  onSend,
  onStop,
  queuePaused,
  onResumeQueue,
  goal = null,
  queue = [],
  onToggleGoal,
  onClearGoal,
  onVerifyGoal,
  onRemoveQueued,
  placeholder,
  autoFocus,
  header,
  activity,
  offline,
  restore,
  editing,
  onResume,
  resumeLabel,
  limited,
  onCancelEdit,
  draftKey,
  computerId,
  taskId,
  scope,
  chatId,
}: {
  draftKey?: string
  computerId?: string
  taskId?: string
  /** Where `@` and `/` look for files and skills: the chat's task, or `project:<id>` before a chat exists. Defaults to `taskId`. */
  scope?: string
  /** Lets chat-only commands (`/changes`) act on this chat. */
  chatId?: string
  running: boolean
  model: ModelChoice
  onModel: (m: ModelChoice) => void
  onSend: (
    text: string,
    mode: 'send' | 'queue' | 'steer',
    attachments?: string[],
    context?: FileContext[],
  ) => Promise<void | false> | void | false
  onStop?: () => void
  goal?: ChatGoal | null
  queue?: QueuedMessage[]
  queuePaused?: boolean
  onResumeQueue?: () => void
  onToggleGoal?: () => void
  onClearGoal?: () => void
  /** Sets the goal's verification command (null removes it). The shield button shows only on hosts that have it. */
  onVerifyGoal?: (command: string | null) => Promise<void>
  onRemoveQueued?: (id: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Extra controls above the input, e.g. the project and checkout pickers. */
  header?: ReactNode
  activity?: ReactNode
  /** The computer is unreachable: sends go to the outbox. */
  offline?: boolean
  /** Puts text back into the input (e.g. a cancelled outbox message); `n` changes on every restore. */
  restore?: { text: string; n: number }
  /** A message being revised: shown as a banner with Cancel; the screen decides what sending does. */
  editing?: { label: string }
  /** The turn was stopped or failed, or the thread is at a usage limit: an empty message box offers to continue or try again. */
  onResume?: () => void
  /** Label for that play button; "Try again" at a limit. */
  resumeLabel?: string
  /** The thread is held at a usage limit: the send button reads Queue and the model chip carries a marker. */
  limited?: boolean
  onCancelEdit?: () => void
}) {
  const textInput = useRef<import('react-native').TextInputInstance>(null)
  useEffect(() => {
    if (!autoFocus) return
    const frame = requestAnimationFrame(() => textInput.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [autoFocus])
  const { c } = useTheme()
  const t = useT()
  const store = useStore()
  const say = (text: string) => translate(store.language, text)
  const [text, setText] = useState(() => (draftKey ? (store.drafts[draftKey] ?? '') : ''))
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const decodeDraft = <T,>(suffix: string, fallback: T): T => {
    try {
      return draftKey ? (JSON.parse(store.drafts[`${draftKey}:${suffix}`] ?? 'null') ?? fallback) : fallback
    } catch {
      return fallback
    }
  }
  const [attachments, setAttachments] = useState<import('@ramu/shared/types').Attachment[]>(() =>
    decodeDraft('attachments', []),
  )
  const [context, setContext] = useState<FileContext[]>(() => decodeDraft('context', []))
  const [mentions, setMentions] = useState<
    { file: { repoId: string; path: string }; insertion: string; token?: string }[]
  >(() => decodeDraft('mentions', []))
  const [caret, setCaret] = useState(0)
  const [forced, setForced] = useState<{ start: number; end: number } | undefined>()
  const [menu, setMenu] = useState<'actions' | 'skills' | 'settings' | null>(null)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [filter, setFilter] = useState('')
  const [uploading, setUploading] = useState(false)
  const uploadPending = useRef(false)
  const origin = useRef(draftKey)
  origin.current = draftKey
  const pc = computerId ?? store.selected
  const attachmentOwner = useRef('')
  attachmentOwner.current = JSON.stringify([pc, draftKey])
  // The Auto-resume choice belongs to the thread's session, so it is offered once the thread has one.
  const limitChat = chatId ? store.chats.find((entry) => entry.id === chatId) : undefined
  const split = useMemo(() => splitQuotes(text), [text])
  const suggest = useComposerSuggest({ computerId: pc, scope: scope ?? taskId, chatId, text: split.body, caret })
  // Takes the editable body (without quotes) and keeps the quotes in front of it in the draft.
  const save = (next: string) => {
    setText(next)
    if (draftKey) store.setDraft(draftKey, next)
  }
  const edit = (value: string) =>
    save(
      joinQuotes(
        split.quotes.map((quote) => quote.source),
        value,
      ),
    )
  const removeQuote = (index: number) =>
    save(
      joinQuotes(
        split.quotes.filter((_, i) => i !== index).map((quote) => quote.source),
        split.body,
      ),
    )
  // Dictation: a take belongs to this host's draft and the revision it started from, so an edit, restored draft or
  // another thread never receives its text. Voice choices are device-local (never host preferences).
  const [voiceSettings] = useVoiceSettings()
  const [voiceRefresh, setVoiceRefresh] = useState(0)
  const voiceCapability = useVoiceCapability(voiceSettings, voiceRefresh)
  const mic = useMicControl(voiceSettings, voiceCapability)
  const revision = useRef(0)
  const selectionEnd = useRef(0)
  const bodyText = useRef(split.body)
  bodyText.current = split.body
  const dictationKey = `${pc}:${draftKey ?? 'composer'}`
  const dictation = useDictation({
    draftKey: dictationKey,
    settings: voiceSettings,
    getDraft: () => ({ draftKey: dictationKey, revision: revision.current, text: bodyText.current }),
    onInsert: ({ text: next, caret: at }) => {
      edit(next)
      setCaret(at)
      setForced({ start: at, end: at })
    },
  })
  const dictating = dictationBusy(dictation.snapshot.state)
  const startDictation = () => {
    if (mic.kind === 'blocked') {
      Alert.alert(
        t.dictate,
        mic.reason === 'permission-denied' ? t.dictatePermissionDenied : t.dictateLanguageUnsupported,
        mic.reason === 'permission-denied'
          ? [
              { text: t.dictateDiscard, style: 'cancel' },
              { text: t.dictateOpenSettings, onPress: () => void Linking.openSettings() },
            ]
          : undefined,
      )
      return
    }
    if (mic.kind === 'setup' && mic.reason === 'model-needed') {
      const size = mic.modelBytes
        ? fill(t.dictateModelSize, `${Math.max(1, Math.round(mic.modelBytes / 1_000_000))} MB`)
        : t.dictateModelNeeded
      Alert.alert(t.dictateSetup, size, [
        { text: t.dictateDiscard, style: 'cancel' },
        {
          text: t.voiceDownloadModel,
          onPress: () =>
            void prepareVoiceModel(
              voiceCapability?.resolvedLanguage ?? voiceSettings.language,
              new AbortController().signal,
            )
              .then(() => setVoiceRefresh((n) => n + 1))
              .catch(() => Alert.alert(t.dictate, t.dictateFailedModel)),
        },
      ])
      return
    }
    if (mic.kind === 'hidden') return
    dictation.session.start({
      draftKey: dictationKey,
      revision: revision.current,
      selection: { start: Math.min(caret, selectionEnd.current), end: Math.max(caret, selectionEnd.current) },
    })
  }
  const pick = (choice: Parameters<typeof suggest.choose>[0]) => {
    const next = suggest.choose(choice)
    // Inline like the desktop: the mention stays in the sentence, as a short @name (coloured like a badge). A text field can't
    // swap its text for a view, so the full @"repo/path" is only filled in when the message is sent.
    if (next.file) {
      const file = next.file
      const parts = file.path.split('/')
      const short = (n: number) => `@${parts.slice(-n).join('/')} `
      let token = short(1)
      const clash = (t: string) =>
        mentions.some(
          (m) => (m.token ?? m.insertion) === t && (m.file.repoId !== file.repoId || m.file.path !== file.path),
        )
      if (clash(token) && parts.length > 1) token = short(2)
      // Names a reference can't carry (spaces, symbols) keep the full form.
      if (!/^@[\w./-]+ $/.test(token) || !/[./]/.test(token) || clash(token)) token = next.insertion
      const start = next.caret - next.insertion.length
      const text = next.text.slice(0, start) + token + next.text.slice(next.caret)
      setMentions((old) =>
        old.some((m) => (m.token ?? m.insertion) === token)
          ? old
          : [...old, { file, token, insertion: next.insertion }],
      )
      edit(text)
      setCaret(start + token.length)
      setForced({ start: start + token.length, end: start + token.length })
      return
    }
    edit(next.text)
    setCaret(next.caret)
    setForced({ start: next.caret, end: next.caret })
  }
  const chips = useMemo(() => composerDraft(split.body).segments, [split.body])
  const append = (value: string) => {
    const next = text + value
    setText(next)
    if (draftKey) store.setDraft(draftKey, next)
  }
  const discoverScope = scope ?? taskId
  const discoveryOwner = JSON.stringify([pc, discoverScope, draftKey])
  const discovery = useRef(discoveryOwner)
  discovery.current = discoveryOwner
  useEffect(() => {
    discovery.current = discoveryOwner
    setMenu(null)
    setSkills([])
    return () => {
      if (discovery.current === discoveryOwner) discovery.current = ''
    }
  }, [discoveryOwner])
  // iOS cannot present a picker or another sheet while the menu is still sliding away, so the next step waits for it.
  const menuTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(menuTimer.current), [])
  const afterMenu = (run: () => void) => {
    setMenu(null)
    clearTimeout(menuTimer.current)
    menuTimer.current = setTimeout(run, SHEET_SETTLE_MS)
  }
  const discover = async () => {
    if (!discoverScope || !store.isOnline(pc)) return
    const owner = discoveryOwner
    try {
      const skills = await store.invoke(pc, 'skills.list', discoverScope)
      if (discovery.current !== owner) return
      setSkills(skills)
      setFilter('')
      setMenu('skills')
    } catch (e) {
      if (discovery.current !== owner) return
      Alert.alert(say('Could not load host choices'), e instanceof Error ? e.message : String(e))
    }
  }
  const upload = async (kind: 'document' | 'camera' | 'photos') => {
    if (attachments.length >= 10) return Alert.alert('Attachments', 'Attach up to ten files per message.')
    if (uploadPending.current) return
    uploadPending.current = true
    const owner = attachmentOwner.current
    setUploading(true)
    setMenu(null)
    try {
      await pickAttachment(
        store,
        pc,
        (a) => {
          if (attachmentOwner.current === owner) setAttachments((old) => [...old, a])
        },
        kind,
      )
    } finally {
      uploadPending.current = false
      setUploading(false)
    }
  }
  useEffect(() => {
    if (draftKey) store.setDraft(`${draftKey}:attachments`, JSON.stringify(attachments))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [attachments] by design; the values it reads beyond these are current as of that run
  }, [attachments])
  useEffect(() => {
    if (draftKey) store.setDraft(`${draftKey}:context`, JSON.stringify(context))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [context] by design; the values it reads beyond these are current as of that run
  }, [context])
  useEffect(() => {
    if (draftKey) store.setDraft(`${draftKey}:mentions`, JSON.stringify(mentions))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mentions] by design; the values it reads beyond these are current as of that run
  }, [mentions])
  const restoredOwner = useRef(draftKey)
  useEffect(() => {
    if (restoredOwner.current === draftKey) return
    restoredOwner.current = draftKey
    setText(draftKey ? (store.drafts[draftKey] ?? '') : '')
    setAttachments(decodeDraft('attachments', []))
    setContext(decodeDraft('context', []))
    setMentions(decodeDraft('mentions', []))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [draftKey] by design; the values it reads beyond these are current as of that run
  }, [draftKey])
  // Explorer can append a reference while this screen remains mounted underneath its file preview.
  const storedContext = draftKey ? store.drafts[`${draftKey}:context`] : undefined
  useFocusEffect(
    useCallback(() => {
      const next = decodeDraft<FileContext[]>('context', [])
      setContext((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
      // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [draftKey, storedContext] by design; the values it reads beyond these are current as of that run
    }, [draftKey, storedContext]),
  )
  const { mode } = resolveBusyMode(
    store.drafts?.[BUSY_MODE_DEVICE_KEY],
    sharedValue(store.mobileLayers?.[pc], 'queueWhileBusy'),
    store.appPreferences?.[pc]?.busyMessageAction,
  )
  const otherMode = otherBusyMode(mode)
  useEffect(() => {
    if (restore) setText(restore.text)
  }, [restore])
  useEffect(() => {
    revision.current += 1
  }, [text, draftKey])
  const has = text.trim().length > 0 || attachments.length > 0 || context.length > 0
  const viewOnly = store.computers?.find((computer) => computer.id === pc)?.access === 'viewer'
  const submit = async (sendMode: 'queue' | 'steer' = mode) => {
    if (!has || viewOnly || sending.current || uploading || dictating) return

    sending.current = true
    setBusy(true)
    const submittedOwner = origin.current
    const submittedDraft = {
      text,
      attachments: JSON.stringify(attachments),
      context: JSON.stringify(context),
      mentions: JSON.stringify(mentions),
    }
    try {
      // Keep the text visible until the destination accepts it into its local outbox.
      if (origin.current !== submittedOwner) return
      const sent = text.trim()
      // A mention counts only while its badge is still in the message, as on the desktop.
      const used = mentions.filter((m) => sent.includes((m.token ?? m.insertion).trim()))
      const mentioned = used.map((m): FileContext => ({ ...m.file, source: 'mention' }))
      // Short tokens become the full reference the agent (and the desktop) understand.
      let expanded = sent
      for (const m of used)
        if (m.token && m.token !== m.insertion) expanded = expanded.split(m.token.trim()).join(m.insertion.trim())
      const mentionedKeys = new Set(mentioned.map(fileContextKey))
      const merged = [...mentioned, ...context.filter((file) => !mentionedKeys.has(fileContextKey(file)))]
      if (merged.length > 30) throw new Error(t.fileReferenceLimit)
      if (draftKey && store.drafts[`${draftKey}:restored-attachments`] === 'yes' && attachments.length) {
        if (!store.isOnline(pc)) throw new Error(t.savedAttachmentOffline)
        const status = await store.invoke(
          pc,
          'attachments.status',
          attachments.map((file) => file.id),
        )
        if (attachments.some((file) => !status.some((entry) => entry.id === file.id && entry.available)))
          throw new Error(t.savedAttachmentMissing)
        if (origin.current !== submittedOwner) return
      }
      if (origin.current !== submittedOwner) return
      const accepted = await onSend(
        expanded,
        running ? sendMode : 'send',
        attachments.map((a) => a.id),
        merged,
      )
      // Destination clarification is still composing; retain the reviewed draft and its attachments.
      if (accepted === false) {
        return
      }
      if (origin.current !== submittedOwner) return
      if (draftKey && !store.clearComposerDraft(draftKey, submittedDraft)) {
        return
      }
      textInput.current?.clear()
      setText('')
      setAttachments([])
      setContext([])
      setMentions([])
      setCaret(0)
      setForced(undefined)
      if (draftKey) {
        store.setDraft(draftKey, '')
        store.setDraft(`${draftKey}:restored-attachments`, '')
      }
    } catch (error) {
      Alert.alert('Could not send', error instanceof Error ? error.message : String(error))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Glass radius={radius.xl} style={{ marginHorizontal: space.s + 2 }}>
      {header ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            padding: 4,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: c.lineStrong,
          }}
        >
          {header}
        </View>
      ) : null}
      {limited && chatId ? <LimitTray chatId={chatId} /> : null}
      {activity}
      {!activity && (
        <GoalQueueTray
          goal={goal}
          queue={queue}
          paused={queuePaused}
          onResumeQueue={onResumeQueue}
          onToggleGoal={onToggleGoal}
          onClearGoal={onClearGoal}
          onVerifyGoal={onVerifyGoal}
          verifyOffered={canEditVerify(goal)}
          onRemove={onRemoveQueued}
        />
      )}
      {attachments.length || context.length || split.quotes.length ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.m, paddingTop: space.s }}
        >
          {split.quotes.map((quote, index) => (
            <ContextChip
              key={`quote-${index}`}
              icon={Quote}
              label={quote.label.replace(/\s+/g, ' ')}
              detail={quote.label}
              remove={() => removeQuote(index)}
            />
          ))}
          {attachments.map((a) => (
            <ContextChip
              key={a.id}
              icon={Paperclip}
              label={a.name}
              detail={
                draftKey && store.drafts[`${draftKey}:restored-attachments`] === 'yes'
                  ? t.attachmentNeedsCheck
                  : undefined
              }
              remove={() => setAttachments((old) => old.filter((x) => x.id !== a.id))}
            />
          ))}
          {context.map((file) => (
            <ContextChip
              key={`${file.repoId}:${file.path}`}
              icon={FileText}
              label={file.path.split('/').at(-1) ?? file.path}
              detail={file.path}
              remove={() => setContext((old) => old.filter((f) => f !== file))}
            />
          ))}
        </View>
      ) : null}
      {uploading ? (
        <T size={font.caption} tone="muted" style={{ padding: space.s }}>
          Uploading to this host…
        </T>
      ) : null}
      {editing ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s,
            paddingLeft: space.l,
            paddingRight: 4,
            height: 34,
            borderBottomWidth: 0.5,
            borderBottomColor: c.lineStrong,
          }}
        >
          <Pencil size={13} color={c.accent} />
          <T size={font.control} tone="soft" numberOfLines={1} style={{ flex: 1 }}>
            {editing.label}
          </T>
          <IconButton icon={X} label={say('Cancel editing')} size={30} tone="muted" onPress={() => onCancelEdit?.()} />
        </View>
      ) : null}
      {suggest.visible ? (
        <SuggestionList choices={suggest.choices} loading={suggest.loading} error={suggest.error} onChoose={pick} />
      ) : null}
      {viewOnly ? (
        <T tone="muted" size={font.caption} style={{ paddingTop: space.s }} accessibilityRole="alert">
          {store.language === 'id'
            ? 'Perangkat ini hanya bisa melihat thread dan menjawab permintaan, tidak mengirim pesan. Minta pemilik host memasangkannya dengan akses penuh.'
            : 'This phone can view threads and answer requests, but not send messages. Ask the host owner to pair it with full access.'}
        </T>
      ) : null}
      <View style={{ paddingTop: space.s }}>
        <View style={{ paddingHorizontal: space.s }}>
          <DictationStatus
            state={dictation.snapshot.state}
            level={dictation.snapshot.level}
            onStop={() => dictation.session.stop()}
            onCancel={() => dictation.session.cancel()}
            onDismiss={() => dictation.session.cancel()}
            onInsert={() => {
              const inserted = dictation.session.insertReview(
                { draftKey: dictationKey, revision: revision.current, text: bodyText.current },
                { start: caret, end: caret },
              )
              if (!inserted) dictation.session.cancel()
            }}
            showSettings
          />
        </View>
        <TextInput
          onChangeText={(value) => {
            edit(value)
            if (forced) setForced(undefined)
          }}
          onSelectionChange={(event) => {
            setCaret(event.nativeEvent.selection.start)
            selectionEnd.current = event.nativeEvent.selection.end
            if (forced && event.nativeEvent.selection.start === forced.start) setForced(undefined)
          }}
          selection={forced}
          multiline
          editable={!busy && !viewOnly && !dictating}
          ref={textInput}
          placeholder={
            dictation.snapshot.state.phase === 'recording' ? t.dictateListening : (placeholder ?? t.messagePlaceholder)
          }
          placeholderTextColor={c.placeholder}
          style={{
            color: c.text,
            fontSize: font.body,
            lineHeight: 21,
            maxHeight: 140,
            minHeight: 40,
            paddingHorizontal: space.m + 2,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          {/* Finished references (@file, $skill, /command, quotes) show as badges; the text itself is unchanged, so the agent still receives it. */}
          <Text style={{ color: c.text }}>
            {chips.map((part, index) =>
              part.kind === 'text' ? (
                part.source
              ) : (
                <Text key={index} style={{ color: c.accent, fontWeight: REFERENCE_APPEARANCE.fontWeight }}>
                  {part.source}
                </Text>
              ),
            )}
          </Text>
        </TextInput>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: space.s - 2,
            paddingBottom: space.s - 2,
            gap: 4,
          }}
        >
          <IconButton
            icon={Plus}
            label={say('Attach')}
            size={34}
            tone="muted"
            style={{ borderRadius: radius.full }}
            onPress={() => setMenu('actions')}
          />
          {mic.kind !== 'hidden' ? (
            <MicButton
              active={dictating}
              disabled={viewOnly || (dictating && dictation.snapshot.state.phase !== 'recording')}
              onPress={() =>
                dictation.snapshot.state.phase === 'recording' ? dictation.session.stop() : startDictation()
              }
            />
          ) : null}
          <ModelChip value={model} onChange={onModel} computerId={computerId} limited={limited} />

          <View style={{ flex: 1 }} />
          {running && has && !offline ? (
            <IconButton
              icon={otherMode === 'queue' ? ListPlus : CornerDownRight}
              label={otherMode === 'queue' ? t.queue : t.steer}
              size={34}
              tone="muted"
              onPress={() => void submit(otherMode)}
              disabled={busy || uploading || viewOnly || dictating}
            />
          ) : null}
          {running && !has && !offline ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.stop}
              onPress={() => {
                tap()
                onStop?.()
              }}
              style={{
                width: 34,
                height: 34,
                borderRadius: radius.full,
                backgroundColor: c.text,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Square size={13} color={c.canvas} fill={c.canvas} />
            </Pressable>
          ) : onResume && !has && !running && !offline ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={resumeLabel ?? 'Continue where the agent left off'}
              onPress={() => {
                tap()
                onResume()
              }}
              style={{
                width: 34,
                height: 34,
                borderRadius: radius.full,
                backgroundColor: c.fill,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Play size={15} color={c.text} fill={c.text} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                offline
                  ? 'Add to outbox'
                  : limited
                    ? t.queue
                    : running
                      ? mode === 'queue'
                        ? t.queue
                        : t.steer
                      : 'Send'
              }
              disabled={!has || viewOnly || busy || uploading || dictating}
              // A 34-point button beside the keyboard is easy to miss; the touch area reaches past it.
              hitSlop={10}

              onPress={() => {
                tap()
                void submit()
              }}
              style={{
                width: 34,
                height: 34,
                borderRadius: radius.full,
                backgroundColor: has ? c.primary : c.fill,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {offline ? (
                <Clock size={16} color={has ? c.primaryInk : c.placeholder} strokeWidth={2.4} />
              ) : running ? (
                <CornerDownRight size={18} color={has ? c.primaryInk : c.placeholder} />
              ) : (
                <ArrowUp size={18} color={has ? c.primaryInk : c.placeholder} strokeWidth={2.4} />
              )}
            </Pressable>
          )}
        </View>
      </View>
      <Sheet open={menu === 'actions'} onClose={() => setMenu(null)} title={say('Add to message')}>
        <SheetGroup>
          {(
            [
              {
                key: 'file',
                icon: Paperclip,
                label: 'Attach a file',
                help: 'Any document up to 10 MB.',
                run: () => void upload('document'),
              },
              {
                key: 'photo',
                icon: ImageIcon,
                label: 'Choose a photo',
                help: 'From your photo library.',
                run: () => void upload('photos'),
              },
              {
                key: 'camera',
                icon: Camera,
                label: 'Take a photo',
                help: 'Use the camera now.',
                run: () => void upload('camera'),
              },
              ...(discoverScope && !offline
                ? [
                    {
                      key: 'skills',
                      icon: Sparkles,
                      label: 'Use a skill',
                      help: 'Point the agent at a skill on the host.',
                      run: () => void discover(),
                    },
                  ]
                : []),
            ] as { key: string; icon: Icon; label: string; help: string; run(): void }[]
          ).map((item) => (
            <SheetOption
              key={item.key}
              icon={item.icon}
              title={say(item.label)}
              help={say(item.help)}
              onPress={() => afterMenu(item.run)}
            />
          ))}
        </SheetGroup>
        <SheetGroup>
          <SheetOption
            icon={SlidersHorizontal}
            title={say('Agent settings')}
            help={say('Permissions, provider fallback and speed for this thread.')}
            onPress={() => afterMenu(() => setMenu('settings'))}
          />
        </SheetGroup>
      </Sheet>
      <Sheet
        open={menu === 'skills'}
        onClose={() => setMenu(null)}
        title={say('Host skills')}
        search={{ value: filter, onChangeText: setFilter, placeholder: say('Search…') }}
      >
        <SheetGroup>
          {skills
            .filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(filter.toLowerCase()))
            .slice(0, 200)
            .map((skill) => (
              <SheetOption
                key={skill.path}
                icon={Sparkles}
                title={skill.name}
                help={skill.description}
                onPress={() => {
                  append(`\nUse the host skill at ${skill.path}.`)
                  setMenu(null)
                }}
              />
            ))}
        </SheetGroup>
      </Sheet>
      <Sheet open={menu === 'settings'} onClose={() => setMenu(null)} title={say('Agent settings')}>
        <SheetGroup title={say('Permissions')} footer={say('Applies to this thread from its next step.')}>
          {ACCESS_MODES.map((mode) => (
            <SheetOption
              key={mode.key}
              icon={mode.icon}
              title={say(mode.label)}
              help={say(mode.help)}
              selected={(model.settings?.access ?? 'auto') === mode.key}
              onPress={() =>
                onModel({
                  ...model,
                  settings: {
                    access: mode.key,
                    autoFallback: model.settings?.autoFallback ?? true,
                    serviceTier: model.settings?.serviceTier,
                  },
                })
              }
            />
          ))}
        </SheetGroup>
        <SheetGroup title={say('Behavior')}>
          <SheetOption
            icon={Shuffle}
            title={say('Automatic provider fallback')}
            help={say('Switch to the next provider when this one hits a limit.')}
            trailing={
              <Toggle
                accessibilityLabel={say('Automatic provider fallback')}
                value={model.settings?.autoFallback ?? true}
                onValueChange={(autoFallback) =>
                  onModel({
                    ...model,
                    settings: {
                      access: model.settings?.access ?? 'auto',
                      autoFallback,
                      serviceTier: model.settings?.serviceTier,
                    },
                  })
                }
              />
            }
            onPress={() =>
              onModel({
                ...model,
                settings: {
                  access: model.settings?.access ?? 'auto',
                  autoFallback: !(model.settings?.autoFallback ?? true),
                  serviceTier: model.settings?.serviceTier,
                },
              })
            }
          />
          <SheetOption
            icon={Zap}
            title={say('Fast mode')}
            help={say('Answers sooner on providers that offer a priority tier, at a higher usage cost.')}
            trailing={
              <Toggle
                accessibilityLabel={say('Fast mode')}
                value={model.settings?.serviceTier === 'fast'}
                onValueChange={(fast) =>
                  onModel({
                    ...model,
                    settings: {
                      access: model.settings?.access ?? 'auto',
                      autoFallback: model.settings?.autoFallback ?? true,
                      serviceTier: fast ? 'fast' : 'standard',
                    },
                  })
                }
              />
            }
            onPress={() =>
              onModel({
                ...model,
                settings: {
                  access: model.settings?.access ?? 'auto',
                  autoFallback: model.settings?.autoFallback ?? true,
                  serviceTier: model.settings?.serviceTier === 'fast' ? 'standard' : 'fast',
                },
              })
            }
          />
        </SheetGroup>
        {limitChat?.sessionId && !!store.appPreferences[limitChat.computerId] ? (
          <AutoResumeRows chatId={limitChat.id} />
        ) : null}
      </Sheet>
    </Glass>
  )
}

async function pickAttachment(
  store: ReturnType<typeof useStore>,
  computerId: string,
  add: (attachment: import('@ramu/shared/types').Attachment) => void,
  kind: 'document' | 'camera' | 'photos' = 'document',
) {
  try {
    if (!store.isOnline(computerId)) throw new Error('Reconnect this host to upload an attachment.')
    let asset: { uri: string; name: string; size?: number; file?: File }
    if (kind === 'document') {
      const { getDocumentAsync } = await import('expo-document-picker')
      const result = await getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
      if (result.canceled) return
      asset = result.assets[0]!
    } else {
      const picker = await import('expo-image-picker')
      if (kind === 'camera' && !(await picker.requestCameraPermissionsAsync()).granted)
        throw new Error('Camera permission is required to take a photo.')
      const result =
        kind === 'camera'
          ? await picker.launchCameraAsync({ quality: 0.8 })
          : await picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 })
      if (result.canceled) return
      const photo = result.assets[0]!
      asset = { uri: photo.uri, name: photo.fileName ?? `photo-${Date.now()}.jpg`, size: photo.fileSize }
    }
    if ((asset.size ?? 0) > 10_000_000) throw new Error('Attachments must be 10 MB or smaller.')
    const { File } = await import('expo-file-system')
    const base64 = asset.file
      ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',')[1]!)
          reader.onerror = reject
          reader.readAsDataURL(asset.file!)
        })
      : await new File(asset.uri).base64()
    if (base64.length > 13_400_000) throw new Error('Attachments must be 10 MB or smaller.')
    add(await store.invoke(computerId, 'attachments.add', asset.name, base64))
  } catch (error) {
    Alert.alert('Attachment failed', error instanceof Error ? error.message : String(error))
  }
}

/** Quoted passages ("> line" blocks) leave the text field and show as chips above it, as on the desktop; the body is what stays editable. */
function splitQuotes(text: string) {
  const quotes = composerDraft(text).chips.filter((chip) => chip.kind === 'quote')
  if (!quotes.length) return { quotes, body: text }
  let body = '',
    cursor = 0
  for (const quote of quotes) {
    body += text.slice(cursor, quote.start)
    cursor = quote.end
    const gap = /^\n{1,2}/.exec(text.slice(cursor))
    if (gap) cursor += gap[0].length
  }
  return { quotes, body: body + text.slice(cursor) }
}
const joinQuotes = (quotes: string[], body: string) => quotes.map((quote) => `${quote}\n\n`).join('') + body

function ContextChip({
  icon: I,
  label,
  detail,
  remove,
}: {
  icon: typeof FileText
  label: string
  detail?: string
  remove: () => void
}) {
  const { c } = useTheme()
  return (
    <View
      accessibilityLabel={detail ?? label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 26,
        paddingLeft: 8,
        paddingRight: 2,
        borderRadius: radius.full,
        backgroundColor: c.fill,
        maxWidth: 220,
      }}
    >
      <I size={12} color={c.accent} />
      <T size={font.caption + 1} weight="500" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
        hitSlop={8}
        onPress={() => {
          tap()
          remove()
        }}
        style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}
      >
        <X size={12} color={c.muted} />
      </Pressable>
    </View>
  )
}

/**
 * The desktop's model bar: one slider over the model set's steps (e.g. Sol low → Sol medium → Astra medium) or, switched, over
 * the current model's reasoning efforts. The label follows the thumb; the choice applies on release.
 */
function QuickSteps({
  value,
  models,
  prefs,
  computerId,
  onChange,
}: {
  value: ModelChoice
  models: ModelRow[]
  prefs?: import('@ramu/shared/types').ModelPreferences | null
  computerId: string
  onChange: (m: ModelChoice) => void
}) {
  const { c } = useTheme()
  // This phone's own choice, then the shared mobile setting, then the computer's. Changing it only redraws the control.
  const flow = useModelFlow(computerId).effective.value
  const [mode, setMode] = useState<'model' | 'effort'>(flow)
  useEffect(() => {
    setMode(flow)
  }, [flow])
  const [setId, setSetId] = useState(prefs?.defaultSetId ?? '')
  if (!prefs?.sets.length && mode === 'model') return null
  const set = prefs?.sets.find((s) => s.id === setId) ?? prefs?.sets[0]
  const row = (provider: AgentProvider, model: string) =>
    models.find((m) => m.provider === provider && (m.model === model || (!model && m.isDefault)))
  const current = row(value.provider, value.model)
  const explicit = value.provider === 'claude-code' || value.provider === 'codex'
  const effortNow = value.effort || (explicit ? current?.defaultEffort : '') || ''
  const steps = (set?.steps ?? []).filter((step) => {
    const r = row(step.provider, step.model)
    return r && (!step.effort || r.efforts.includes(step.effort))
  })
  const efforts = [...(explicit ? [] : ['']), ...(current?.efforts ?? [])]
  const items =
    mode === 'model'
      ? steps.map((step) => ({
          label: `${row(step.provider, step.model)?.label ?? step.model} ${effortWord(step.effort ?? '')}`.trim(),
          pick: { provider: step.provider, model: step.model, effort: step.effort ?? '' },
        }))
      : efforts.map((e) => ({
          label: e || 'Default',
          pick: { provider: value.provider, model: value.model, effort: e },
        }))
  const index =
    mode === 'model'
      ? steps.findIndex(
          (step) =>
            step.provider === value.provider &&
            (step.model === value.model || (!value.model && step.model === current?.model)) &&
            (step.effort ?? '') === effortNow,
        )
      : efforts.indexOf(effortNow)
  if (items.length < 2) return null
  const shown = items[index]
  const cap = (s: string) => (s === 'xhigh' ? 'Extra high' : s.replace(/\b\w/g, (ch) => ch.toUpperCase()))
  // Effort mode keeps the model in view: the levels below belong to it.
  const heading =
    mode === 'effort'
      ? `${current?.label ?? value.model ?? ''}${shown ? ` · ${cap(shown.label)}` : ''}`
      : (shown?.label ?? 'Custom')
  return (
    <View style={{ paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.m, gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <T size={font.control} weight="600" style={{ flex: 1 }} numberOfLines={1}>
          {heading}
        </T>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { key: 'model', label: 'Steps' },
            { key: 'effort', label: 'Effort' },
          ]}
          style={{ width: 150 }}
        />
      </View>
      {mode === 'model' ? (
        // One tap per step: a slider inside a sheet fought the sheet's own drag.
        <View accessibilityRole="radiogroup" accessibilityLabel="Model set step" style={{ marginHorizontal: -space.l }}>
          {items.map((item, i) => (
            <Row
              key={`${item.pick.provider}:${item.pick.model}:${item.pick.effort}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: i === index }}
              onPress={() => {
                tap()
                onChange({ settings: value.settings, ...item.pick })
              }}
            >
              <T style={{ flex: 1 }} weight={i === index ? '600' : '400'} numberOfLines={1}>
                {item.label}
              </T>
              {i === index ? <Check size={17} color={c.accent} /> : null}
            </Row>
          ))}
        </View>
      ) : (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Reasoning effort level"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingTop: space.xs }}
        >
          {items.map((item, i) => (
            <Chip
              key={item.label}
              label={cap(item.label)}
              fill
              selected={i === index}
              onPress={() => {
                tap()
                onChange({ settings: value.settings, ...item.pick })
              }}
            />
          ))}
        </View>
      )}
      {mode === 'model' && (prefs?.sets.length ?? 0) > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {prefs!.sets.map((s) => (
            <Chip key={s.id} label={s.name} small fill selected={s.id === set?.id} onPress={() => setSetId(s.id)} />
          ))}
        </View>
      ) : null}
      {value.provider === 'codex' && current ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: value.settings?.serviceTier === 'fast' }}
          onPress={() => {
            tap()
            onChange({
              ...value,
              settings: {
                access: value.settings?.access ?? 'auto',
                autoFallback: value.settings?.autoFallback ?? true,
                serviceTier: value.settings?.serviceTier === 'fast' ? 'standard' : 'fast',
              },
            })
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.xs }}
        >
          <T size={font.control} tone="soft" style={{ flex: 1 }}>
            Fast mode · higher usage
          </T>
          <T size={font.control} weight="600" tone={value.settings?.serviceTier === 'fast' ? 'accent' : 'muted'}>
            {value.settings?.serviceTier === 'fast' ? 'On' : 'Off'}
          </T>
        </Pressable>
      ) : null}
    </View>
  )
}
