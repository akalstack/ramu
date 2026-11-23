import { isModelListed } from '@ramu/shared/providers/modelVisibility'
import { choosesSpeed } from '@ramu/shared/providers/routing'
import { ProviderRouteChip, useNextRoute } from './ProviderRouteChip'
import { REFERENCE_APPEARANCE } from '@ramu/shared/chat/presentation'
import { isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ActionSheetIOS,
  type TextStyle,
  View,
} from 'react-native'
import { MenuView } from '@react-native-menu/menu'
import { markdownRuns, type MarkdownMark } from '@ramu/shared/chat/markdownRuns'
import { composerDraft } from '@ramu/shared/chat/composerDraft'
import { fileContextKey } from '@ramu/shared/chat/fileContext'
import { contextTokensShort } from '@ramu/shared/chat/compaction'
import { SuggestionList, useComposerSuggest, type ComposerMentions } from './ComposerSuggest'
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
  Search,
  Send,
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
  Users,
  History,
  Minimize2,
} from 'lucide-react-native'
import type { AgentProvider, AgentSettings, ChatGoal, FileContext, QueuedMessage, SkillInfo } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { providerNames } from '../runtime/types'
import { useStore } from '../runtime/store'
import { BUSY_MODE_DEVICE_KEY, resolveBusyMode } from '../runtime/busyMode'
import { sharedValue } from '@ramu/shared/sharedFields'
import { useModelFlow } from '../runtime/useModelFlow'
import { fill, useT, useSay } from '../i18n'
import { translate } from '@ramu/shared/i18n'
import { Chip, IconButton, Pill, Row, SHEET_SETTLE_MS, Segmented, Sheet, T, Toggle, tap, type Icon } from './ui'
import { modelTags } from '@ramu/shared/providers/modelTags'
import { modelLabel as pickerLabel, modelSearchText } from '@ramu/shared/providers/modelLabel'
import { matchesWords } from '@ramu/shared/search/matchWords'
import { SheetGroup, SheetOption } from './SheetOptions'

const ACCESS_MODES = [
  { key: 'edits', label: 'Allow edits', help: 'File edits go through. Commands still ask first.', icon: Pencil },
  {
    key: 'auto',
    label: 'Auto',
    help: 'Approves routine actions where the provider supports it. Everything else still asks.',
    icon: Sparkles,
  },
  {
    key: 'full',
    label: 'Full access',
    help: 'Commands and edits run without asking, except commands that can destroy work.',
    icon: LockOpen,
  },
] as const
import { ProviderIcon } from './Logos'
import { FileIcon } from './FileIcon'
import { useOpenFile } from '../runtime/openFile'
import { Glass } from './Glass'
import { AutoResumeRows, LimitTray } from './LimitTray'
import { AccountRows } from './AccountRows'
import { canEditVerify } from '../runtime/goalVerify'
import { isUserPaused } from '@ramu/shared/chat/goalHold'
import { GoalVerifySheet } from './GoalVerifySheet'
import { DictationStatus, MicButton } from './DictationControls'
import { dictationBusy } from '@ramu/shared/voice/dictation'
import {
  prepareVoiceModel,
  useDictation,
  useMicControl,
  useVoiceCapability,
  useVoiceSettings,
} from '../runtime/useDictation'
import { NextMessageChips } from './NextMessageChips'

export interface ModelChoice {
  provider: AgentProvider
  model: string
  effort: string
  settings?: Pick<AgentSettings, 'access' | 'autoFallback' | 'serviceTier' | 'accountId'>
}

export function modelLabel(m: ModelChoice) {
  return m.model || providerNames[m.provider]
}

/** A model's clean name and route, as the desktop's pickers show them, and what search reads. */
const routedName = (provider: AgentProvider, model: { id: string; name: string }) => {
  const { name, route } = pickerLabel({ provider, id: model.id, name: model.name })
  return { label: name, route, search: modelSearchText({ provider, id: model.id, name: model.name }) }
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
  /** Who serves it when OpenCode routes to another provider ("OpenRouter"); shown in place of the id. */
  route: string | null
  /** Its names, route, provider and id, for search. */
  search: string
  efforts: string[]
  isDefault: boolean
  defaultEffort: string
  /** The speeds the provider lists for it, so Claude's Fast is offered only on models that have it. */
  serviceTiers?: string[]
  tags: import('@ramu/shared/providers/modelTags').ModelTags
}

/**
 * The model picker shows each provider's first models, with the rest of a provider one tap further and a search across
 * all of them, so it never draws hundreds of rows at once (OpenCode lists very many). A model with several reasoning
 * efforts opens them as chips under its row; choosing one closes the picker.
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
  const say = useSay()
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
            ...routedName(p.provider, m),
            efforts: m.efforts as string[],
            isDefault: m.isDefault,
            defaultEffort: (m.defaultEffort ?? '') as string,
            ...(m.serviceTiers ? { serviceTiers: m.serviceTiers } : {}),
            tags: modelTags(m),
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
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<AgentProvider | null>(null)
  // The model whose reasoning efforts are open under its row; one tap away from choosing, with nothing to scroll to.
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // An empty model means "the provider's default": show which model that is rather than just the provider.
  const current =
    models.find((m) => m.provider === value.provider && m.model === value.model) ??
    (value.model ? undefined : models.find((m) => m.provider === value.provider && m.isDefault))
  const label = current?.label ?? modelLabel(value)
  const effort = value.effort || current?.defaultEffort || ''
  const close = () => {
    setOpen(false)
    setExpanded(null)
    setProvider(null)
    setQuery('')
  }
  // The picker closes first and the choice applies once it has gone: a model change mid-conversation asks for
  // confirmation, and iOS cannot show that alert over a full-screen picker that is still closing, so it was dropped.
  const choose = (choice: ModelChoice) => {
    close()
    setTimeout(() => onChange(choice), Platform.OS === 'ios' ? 450 : 0)
  }
  const commit = (m: ModelRow, chosen: string) =>
    choose({ settings: value.settings, provider: m.provider, model: m.model, effort: chosen })
  // One provider's models, or with a query and no provider every model that matches, across providers.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!provider && !needle) return []
    return models.filter((m) => (!provider || m.provider === provider) && (!needle || matchesWords(m.search, needle)))
  }, [models, provider, query])
  const title = provider ? providerNames[provider] : say('Model')
  const back = provider
    ? () => {
        setProvider(null)
        setQuery('')
      }
    : undefined
  const offline = !store.isOnline(computerId ?? store.selected)
  const providerCount = provider ? models.filter((m) => m.provider === provider).length : models.length
  const searchProps = {
    value: query,
    onChangeText: setQuery,
    placeholder: provider
      ? say('Search {0} {1} models', { 0: providerCount, 1: providerNames[provider] })
      : say('Search {0} models', { 0: providerCount }),
  }
  const [limit, setLimit] = useState(MODEL_PAGE)
  useEffect(() => setLimit(MODEL_PAGE), [provider, query])
  const modelRow = (m: ModelRow) => {
    const selected = current?.provider === m.provider && current.model === m.model
    const key = `${m.provider}:${m.model}`
    const open = expanded === key
    // The effort to mark: this thread's own for its current model, else the model's default.
    const marked = selected ? effort : m.defaultEffort
    return (
      <View key={key}>
        <Row
          accessibilityState={m.efforts.length > 1 ? { expanded: open } : undefined}
          onPress={() => {
            tap()
            if (m.efforts.length > 1) setExpanded(open ? null : key)
            else commit(m, m.efforts[0] ?? '')
          }}
        >
          <ProviderIcon provider={m.provider} size={16} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <T weight={selected ? '600' : '400'} numberOfLines={1} style={{ flexShrink: 1 }}>
                {m.label}
              </T>
              {m.tags.legacy ? <Pill>{say('Legacy')}</Pill> : null}
              {m.tags.isNew ? (
                <Pill tone="accent" wash={c.accentWash}>
                  {say('New')}
                </Pill>
              ) : null}
              {m.tags.retires ? (
                <Pill tone="warn" wash={c.warnWash}>
                  {say('Retires {0}', {
                    0: new Date(m.tags.retires).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                  })}
                </Pill>
              ) : null}
            </View>
            <T size={font.caption} tone="muted" mono={!m.route} numberOfLines={1}>
              {m.route ?? m.model}
            </T>
          </View>
          {selected ? (
            <Check size={17} color={c.accent} />
          ) : m.efforts.length > 1 ? (
            <ChevronRight size={15} color={c.placeholder} />
          ) : null}
        </Row>
        {open ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: space.s,
              paddingHorizontal: space.l,
              paddingBottom: space.m,
            }}
          >
            {m.efforts.map((e) => (
              <Chip
                key={e}
                small
                label={e === m.defaultEffort ? `${e} · ${say('default')}` : e}
                selected={e === marked}
                onPress={() => commit(m, e)}
              />
            ))}
          </View>
        ) : null}
      </View>
    )
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={say('Model: {0}', { 0: effort ? `${label}, ${effort}` : label })}
        onPress={() => {
          tap()
          setExpanded(null)
          setProvider(null)
          setQuery('')
          setOpen(true)
        }}
        // It gives way first, so Compact and Send keep their room on a narrow phone: the model's name truncates.
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          flexShrink: 1,
          minWidth: 0,
          gap: 4,
          height: 34,
          paddingHorizontal: space.m - 2,
          borderRadius: radius.full,
          backgroundColor: pressed ? c.pressed : 'transparent',
        })}
      >
        <ProviderIcon provider={value.provider} size={14} />
        <T
          size={font.control}
          weight="500"
          tone="soft"
          numberOfLines={1}
          style={{ marginLeft: 2, maxWidth: 140, flexShrink: 1 }}
        >
          {label}
        </T>
        {effort ? (
          <T size={font.control} tone="muted" numberOfLines={1} style={{ flexShrink: 0 }}>
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
        // Full height, with room for the keyboard while searching: a long model list is a task, not a drawer.
        presentation="screen"
        search={searchProps}
      >
        {back ? (
          <Row onPress={back}>
            <ChevronLeft size={18} color={c.soft} />
            <T tone="soft">{say('All providers')}</T>
          </Row>
        ) : null}
        {provider || query.trim() ? (
          <View>
            {shown.slice(0, limit).map(modelRow)}
            {shown.length > limit ? (
              <Row onPress={() => setLimit((value) => value + MODEL_PAGE)}>
                <T tone="accent" weight="500">
                  {say('Show {0} more of {1}', {
                    0: Math.min(MODEL_PAGE, shown.length - limit),
                    1: shown.length - limit,
                  })}
                </T>
              </Row>
            ) : null}
            {!shown.length ? (
              <T tone="muted" style={{ padding: space.l }}>
                {say('No model matches.')}
              </T>
            ) : null}
          </View>
        ) : (
          <View>
            {/* The login is part of what runs the model, so it is chosen here, with each login's room for it. */}
            <AccountRows
              computerId={computerId ?? store.selected}
              provider={value.provider}
              model={value.model}
              accountId={value.settings?.accountId}
              onPick={(accountId) => {
                onChange({
                  ...value,
                  settings: {
                    access: value.settings?.access ?? 'auto',
                    autoFallback: value.settings?.autoFallback ?? true,
                    serviceTier: value.settings?.serviceTier,
                    accountId,
                  },
                })
                // Stays open: the account is one setting of several here, and the model is often chosen next.
              }}
            />
            <QuickSteps
              value={value}
              models={models}
              prefs={store.modelPrefs[computerId ?? store.selected]}
              computerId={computerId ?? store.selected}
              onChange={choose}
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
                        {say('All {0} {1} models', { 0: own.length, 1: providerNames[p.provider] })}
                      </T>
                      <ChevronRight size={15} color={c.placeholder} />
                    </Row>
                  ) : null}
                </View>
              )
            })}
            {!providers.length ? (
              <T tone="muted" style={{ padding: space.l }}>
                {offline
                  ? say('Reconnect this host to choose a model.')
                  : say('This host has not reported any models yet.')}
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
  onSendNow,
  onSteer,
  onEdit,
  onMove,
  running,
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
  /** Sends a queued message now; while a turn runs, the host stops it first. */
  onSendNow?: (id: string) => void
  /** Steers a queued message into the running turn once its active tools finish, without stopping it. */
  onSteer?: (id: string) => void
  /** Takes a queued message back into the composer to change it. */
  onEdit?: (message: QueuedMessage) => void
  /** Moves a queued message one place earlier or later in the queue. */
  onMove?: (id: string, delta: -1 | 1) => void
  running?: boolean
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
            label={paused ? say('Resume goal') : say('Pause goal')}
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
            {say('Queue paused')}
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
                {say('Resume')}
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {queue.map((q, index) => {
        // While a turn runs the quick action steers (it waits for active tools and keeps the turn); idle, it sends.
        const steerable = running && !!onSteer && q.mode !== 'steer'
        const actions = [
          ...(steerable ? [{ id: 'steer', title: t.steer, image: 'arrow.turn.down.right' }] : []),
          ...(onSendNow
            ? [{ id: 'send', title: say(running ? 'Stop turn and send now' : 'Send now'), image: 'paperplane' }]
            : []),
          ...(onEdit ? [{ id: 'edit', title: say('Edit message'), image: 'pencil' }] : []),
          ...(onMove && index > 0 ? [{ id: 'up', title: say('Move up'), image: 'arrow.up' }] : []),
          ...(onMove && index < queue.length - 1 ? [{ id: 'down', title: say('Move down'), image: 'arrow.down' }] : []),
          ...(onRemove
            ? [{ id: 'remove', title: say('Remove'), image: 'trash', attributes: { destructive: true } }]
            : []),
        ].map((action) => (Platform.OS === 'ios' ? action : { ...action, image: undefined }))
        return (
          <View key={q.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}>
            <MenuView
              title={q.text}
              actions={actions}
              style={{ flex: 1 }}
              onPressAction={({ nativeEvent }) => {
                const choice = nativeEvent.event
                if (choice === 'steer') onSteer?.(q.id)
                else if (choice === 'send') onSendNow?.(q.id)
                else if (choice === 'edit') onEdit?.(q)
                else if (choice === 'up') onMove?.(q.id, -1)
                else if (choice === 'down') onMove?.(q.id, 1)
                else if (choice === 'remove') onRemove?.(q.id)
              }}
            >
              <View
                accessible
                accessibilityRole="button"
                accessibilityHint={say('Queued message actions')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 32 }}
              >
                {q.mode === 'steer' ? (
                  <CornerDownRight size={14} color={c.warn} strokeWidth={1.8} />
                ) : (
                  <ListPlus size={14} color={c.muted} strokeWidth={1.8} />
                )}
                <T size={font.control} tone="soft" numberOfLines={1} style={{ flex: 1 }}>
                  {q.text}
                </T>
                <T size={font.caption} tone="muted" numberOfLines={1}>
                  {q.mode === 'steer' ? t.steer : running ? say('Sends when this turn ends') : t.queued}
                </T>
              </View>
            </MenuView>
            {steerable ? (
              <IconButton
                icon={CornerDownRight}
                label={t.steer}
                size={28}
                tone="muted"
                onPress={() => onSteer?.(q.id)}
              />
            ) : onSendNow && !running ? (
              <IconButton icon={Send} label={say('Send now')} size={28} tone="muted" onPress={() => onSendNow(q.id)} />
            ) : null}
            <IconButton icon={X} label={say('Remove')} size={28} tone="muted" onPress={() => onRemove?.(q.id)} />
          </View>
        )
      })}
    </View>
  )
}

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
  onSendQueuedNow,
  onSteerQueued,
  onEditQueued,
  onMoveQueued,
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
  helpers,
  extraContent,
  onFindQuote,
  compaction,
  nextMessages,
}: {
  /** Predicted next messages for an empty box, shown as chips above it; tapping one puts it in the box to edit or send. */
  nextMessages?: string[]
  /**
   * An idle Claude thread past its prompt cache: Send can compact the history first. The screen decides what sending
   * does; the composer shows the choice beside Send.
   */
  compaction?: { tokens: number; compact: boolean; onChange: (compact: boolean) => void }
  /** Leads a quote back to the message it came from in this thread. */
  onFindQuote?: (quote: string) => void
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
  onSendQueuedNow?: (id: string) => void
  onSteerQueued?: (id: string) => void
  onEditQueued?: (message: QueuedMessage) => void
  onMoveQueued?: (id: string, delta: -1 | 1) => void
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
  /** Models, custom agents and abilities a message can start with as `@handle`, to hand it to a helper. */
  helpers?: ComposerMentions
  /** Something else waits to go with the message (terminal output), so Send works with no words typed. */
  extraContent?: boolean
}) {
  const textInput = useRef<import('react-native').TextInputInstance>(null)
  useEffect(() => {
    if (!autoFocus) return
    // iOS ignores a focus while the screen is still sliding in or a sheet above it is closing, so look again once each
    // has had time to finish; the first focus that takes ends it, and a field already in use is left alone.
    let took = false
    const tries = [0, 350, 700].map((delay) =>
      setTimeout(() => {
        if (took || textInput.current?.isFocused()) {
          took = true
          return
        }
        textInput.current?.focus()
      }, delay),
    )
    return () => tries.forEach(clearTimeout)
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
  const files = useOpenFile(chatId && taskId ? { id: chatId, computerId: pc, taskId } : undefined)
  const attachmentOwner = useRef('')
  attachmentOwner.current = JSON.stringify([pc, draftKey])
  // The Auto-resume choice belongs to the thread's session, so it is offered once the thread has one.
  const limitChat = chatId ? store.chats.find((entry) => entry.id === chatId) : undefined
  const split = useMemo(() => splitQuotes(text), [text])
  const suggest = useComposerSuggest({
    computerId: pc,
    scope: scope ?? taskId,
    chatId,
    text: split.body,
    caret,
    mentions: helpers,
  })
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
    // Picking a helper turns it into the chip straight away.
    const first = composerDraft(splitQuotes(next.text).body, helpers?.mentions).chips[0]
    setChipped(first?.kind === 'mention' && first.start === 0 ? (first.target ?? null) : null)
  }
  const [chipped, setChipped] = useState<string | null>(null)
  // A message that starts with an @model or @custom-agent shows which helper it asks for as a chip before the text field, with the
  // model's icon, since a native text field cannot hold one. The field edits what follows; the draft keeps it all.
  const named = useMemo(() => {
    const first = composerDraft(split.body, helpers?.mentions).chips[0]
    return first?.kind === 'mention' && first.start === 0 ? first : null
  }, [split.body, helpers?.mentions])
  const lead = named && named.target === chipped ? named : null
  // Picked from the list it becomes the chip at once. Typed by hand, it does once typing pauses: rewriting a native
  // field between keystrokes loses or repeats what was typed.
  useEffect(() => {
    if (!named || named.target === chipped) return
    const timer = setTimeout(() => {
      setChipped(named.target ?? null)
      setForced({ start: caret, end: caret })
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-armed on every edit and caret move by design; the setters are stable
  }, [named?.target, chipped, text, caret])
  const prefix = lead ? split.body.slice(0, lead.end + (split.body[lead.end] === ' ' ? 1 : 0)) : ''
  const fieldText = split.body.slice(prefix.length)
  const editField = (value: string) => edit(prefix + value)
  const chips = useMemo(() => composerDraft(fieldText).segments, [fieldText])
  const fieldCaret = caret - prefix.length
  const fileAtCaret = composerDraft(fieldText).chips.find(
    (part) => part.kind === 'file' && fieldCaret > part.start && fieldCaret <= part.end,
  )?.target
  const [quoteOpen, setQuoteOpen] = useState<number | null>(null)
  const openQuote = quoteOpen === null ? undefined : split.quotes[quoteOpen]
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
    if (attachments.length >= 10) return Alert.alert(say('Attachments'), say('Attach up to ten files per message.'))
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
  // Applied when a restore arrives, keyed by its count and text: a caller that rebuilds the same restore on every render
  // must not keep putting back what the person just removed.
  useEffect(() => {
    if (restore) save(restore.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [restore?.n, restore?.text] by design; `save` writes the current draft
  }, [restore?.n, restore?.text])
  useEffect(() => {
    revision.current += 1
  }, [text, draftKey])
  // Where the next message goes when a usage limit would move it to the fallback, as the desktop's route chip says.
  const routeChat = chatId ? store.chats.find((entry) => entry.id === chatId) : undefined
  const nextRoute = useNextRoute(routeChat)
  const has = text.trim().length > 0 || attachments.length > 0 || context.length > 0 || !!extraContent
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
      Alert.alert(say('Could not send'), error instanceof Error ? error.message : String(error))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const holdToChoose = sendChoice(
    running && has && !offline && !limited && !viewOnly && !busy && !uploading && !dictating,
    mode,
    {
      queue: t.queue,
      steer: t.steer,
      queueHelp: say('Send when the agent finishes its turn'),
      steerHelp: say('Send after active tools finish'),
      menu: say('Choose how to send this message'),
      cancel: say('Cancel'),
    },
    (chosen) => {
      tap()
      void submit(chosen)
    },
  )
  return (
    <Glass radius={radius.xl} style={{ marginHorizontal: space.s + 2 }}>
      {header || (nextRoute.chip && routeChat && !limited) ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            padding: 4,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: c.lineStrong,
          }}
        >
          {routeChat && !limited ? (
            <ProviderRouteChip chat={routeChat} chip={nextRoute.chip} onChange={nextRoute.reload} />
          ) : null}
          {header}
        </View>
      ) : null}
      {limited && chatId ? <LimitTray chatId={chatId} /> : null}
      {!text && nextMessages?.length ? <NextMessageChips messages={nextMessages} onUse={edit} /> : null}
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
          onSendNow={onSendQueuedNow}
          onSteer={onSteerQueued}
          onEdit={onEditQueued}
          onMove={onMoveQueued}
          running={running}
        />
      )}
      {attachments.length || context.length || split.quotes.length || (fileAtCaret && chatId && taskId) ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.m, paddingTop: space.s }}
        >
          {split.quotes.map((quote, index) => (
            <ContextChip
              key={`quote-${index}`}
              icon={Quote}
              label={quote.label.replace(/\s+/g, ' ')}
              detail={quote.label}
              open={() => setQuoteOpen(index)}
              remove={() => removeQuote(index)}
            />
          ))}
          {/* A tagged file sits in the text, where a tap only moves the cursor: with the cursor in it, it can open. */}
          {fileAtCaret && chatId && taskId ? (
            <ContextChip
              icon={<FileIcon path={fileAtCaret} size={13} />}
              label={fileAtCaret.split('/').at(-1) ?? fileAtCaret}
              detail={fileAtCaret}
              open={() => void files.openLink(fileAtCaret)}
            />
          ) : null}
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
              icon={<FileIcon path={file.path} size={13} />}
              label={file.path.split('/').at(-1) ?? file.path}
              detail={file.path}
              open={chatId && taskId ? () => files.open(file.repoId, file.path) : undefined}
              remove={() => setContext((old) => old.filter((f) => f !== file))}
            />
          ))}
        </View>
      ) : null}
      {uploading ? (
        <T size={font.caption} tone="muted" style={{ padding: space.s }}>
          {say('Uploading to this host…')}
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
          {say(
            'This phone can view threads and answer requests, but not send messages. Ask the host owner to pair it with full access.',
          )}
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
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {lead ? (
            <View
              accessible
              accessibilityLabel={translate(store.language, 'Ask {0}', { 0: lead.label })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                marginLeft: space.m,
                marginTop: 7,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: radius.full,
                backgroundColor: c.accentSoft,
                maxWidth: 180,
              }}
            >
              {lead.provider ? (
                <ProviderIcon provider={lead.provider} size={13} />
              ) : (
                <Users size={13} color={c.accent} />
              )}
              <Text
                numberOfLines={1}
                style={{ color: c.accent, fontSize: font.control, fontWeight: '600', flexShrink: 1 }}
              >
                {lead.label}
              </Text>
            </View>
          ) : null}
          <TextInput
            onChangeText={(value) => {
              editField(value)
              if (forced) setForced(undefined)
            }}
            onKeyPress={(event) => {
              // Backspace at the very start takes the chip away, as deleting the mention's text would.
              if (
                lead &&
                event.nativeEvent.key === 'Backspace' &&
                caret === prefix.length &&
                selectionEnd.current === caret
              ) {
                edit(fieldText)
                setChipped(null)
              }
            }}
            onSelectionChange={(event) => {
              setCaret(event.nativeEvent.selection.start + prefix.length)
              selectionEnd.current = event.nativeEvent.selection.end + prefix.length
              if (forced && event.nativeEvent.selection.start + prefix.length === forced.start) setForced(undefined)
            }}
            selection={
              forced
                ? {
                    start: Math.max(0, forced.start - prefix.length),
                    end: Math.max(0, forced.end - prefix.length),
                  }
                : undefined
            }
            multiline
            editable={!busy && !viewOnly && !dictating}
            ref={textInput}
            placeholder={
              dictation.snapshot.state.phase === 'recording'
                ? t.dictateListening
                : (placeholder ?? t.messagePlaceholder)
            }
            placeholderTextColor={c.placeholder}
            style={{
              flex: 1,
              color: c.text,
              fontSize: font.body,
              lineHeight: 21,
              maxHeight: 140,
              minHeight: 40,
              paddingHorizontal: space.m + 2,
              paddingLeft: lead ? space.s : space.m + 2,
              paddingTop: 6,
              paddingBottom: 6,
            }}
          >
            {/* Finished references (@file, $skill, /command, quotes) show as badges; the text itself is unchanged, so the agent still receives it. */}
            <Text style={{ color: c.text }}>
              {chips.map((part, index) =>
                part.kind === 'text' ? (
                  <MarkdownText key={index} source={part.source} />
                ) : (
                  <Text key={index} style={{ color: c.accent, fontWeight: REFERENCE_APPEARANCE.fontWeight }}>
                    {part.source}
                  </Text>
                ),
              )}
            </Text>
          </TextInput>
        </View>
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
          <ModelChip value={model} onChange={onModel} computerId={computerId} limited={limited} />

          <View style={{ flex: 1, minWidth: 0 }} />
          {/* Dictation sits beside sending, where the words it writes go next. */}
          {mic.kind !== 'hidden' ? (
            <MicButton
              active={dictating}
              disabled={viewOnly || (dictating && dictation.snapshot.state.phase !== 'recording')}
              onPress={() =>
                dictation.snapshot.state.phase === 'recording' ? dictation.session.stop() : startDictation()
              }
            />
          ) : null}
          {compaction && !running && !offline ? (
            <Chip
              small
              icon={compaction.compact ? Minimize2 : History}
              label={
                compaction.compact
                  ? translate(store.language, 'Compact · {0}', { 0: contextTokensShort(compaction.tokens) })
                  : translate(store.language, 'Keep · {0}', { 0: contextTokensShort(compaction.tokens) })
              }
              selected={compaction.compact}
              accessibilityLabel={translate(store.language, 'Compact {0} tokens of history before sending', {
                0: contextTokensShort(compaction.tokens),
              })}
              accessibilityHint={
                compaction.compact
                  ? say(
                      'Its cache has expired, so the next message re-reads the whole thread. Double-tap to keep the full history instead.',
                    )
                  : say('The next message re-reads the whole thread. Double-tap to compact it first.')
              }
              onPress={() => compaction.onChange(!compaction.compact)}
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
              accessibilityLabel={resumeLabel ?? say('Continue where the agent left off')}
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
              accessibilityHint={holdToChoose ? say('Hold to choose how to send') : undefined}
              accessibilityLabel={
                offline
                  ? say('Add to outbox')
                  : limited
                    ? t.queue
                    : running
                      ? mode === 'queue'
                        ? t.queue
                        : t.steer
                      : compaction?.compact
                        ? say('Compact and send')
                        : say('Send')
              }
              disabled={!has || viewOnly || busy || uploading || dictating}
              // A 34-point button beside the keyboard is easy to miss; the touch area reaches past it.
              hitSlop={10}
              onPress={() => {
                tap()
                void submit()
              }}
              onLongPress={holdToChoose}
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
            help={say('Account, permissions, provider fallback and speed for this thread.')}
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
                  append(`\n${translate(store.language, 'Use the host skill at {0}.', { 0: skill.path })}`)
                  setMenu(null)
                }}
              />
            ))}
        </SheetGroup>
      </Sheet>
      {/* A quote in full, with the way back to where it was said. */}
      <Sheet open={!!openQuote} onClose={() => setQuoteOpen(null)} title={say('Quote')}>
        {openQuote ? (
          <View style={{ paddingHorizontal: space.l, paddingTop: space.s, gap: space.m }}>
            <View style={{ borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingLeft: space.m }}>
              <T tone="soft" selectable style={{ lineHeight: 21 }}>
                {openQuote.label}
              </T>
            </View>
          </View>
        ) : null}
        <SheetGroup>
          {onFindQuote ? (
            <SheetOption
              icon={Search}
              title={say('Show in conversation')}
              onPress={() => {
                const quote = openQuote?.label
                setQuoteOpen(null)
                if (quote) onFindQuote(quote)
              }}
            />
          ) : null}
          <SheetOption
            icon={X}
            title={say('Remove')}
            onPress={() => {
              if (quoteOpen !== null) removeQuote(quoteOpen)
              setQuoteOpen(null)
            }}
          />
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
  const say = (text: string) => translate(store.language, text)
  try {
    if (!store.isOnline(computerId)) throw new Error(say('Reconnect this host to upload an attachment.'))
    let asset: { uri: string; name: string; size?: number; file?: File }
    if (kind === 'document') {
      const { getDocumentAsync } = await import('expo-document-picker')
      const result = await getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
      if (result.canceled) return
      asset = result.assets[0]!
    } else {
      const picker = await import('expo-image-picker')
      if (kind === 'camera' && !(await picker.requestCameraPermissionsAsync()).granted)
        throw new Error(say('Camera permission is required to take a photo.'))
      const result =
        kind === 'camera'
          ? await picker.launchCameraAsync({ quality: 0.8 })
          : await picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 })
      if (result.canceled) return
      const photo = result.assets[0]!
      asset = { uri: photo.uri, name: photo.fileName ?? `photo-${Date.now()}.jpg`, size: photo.fileSize }
    }
    if ((asset.size ?? 0) > 10_000_000) throw new Error(say('Attachments must be 10 MB or smaller.'))
    const { File } = await import('expo-file-system')
    const base64 = asset.file
      ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',')[1]!)
          reader.onerror = reject
          reader.readAsDataURL(asset.file!)
        })
      : await new File(asset.uri).base64()
    if (base64.length > 13_400_000) throw new Error(say('Attachments must be 10 MB or smaller.'))
    add(await store.invoke(computerId, 'attachments.add', asset.name, base64))
  } catch (error) {
    Alert.alert(say('Attachment failed'), error instanceof Error ? error.message : String(error))
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
const joinQuotes = (quotes: string[], body: string) => quotes.map((quote) => `${quote.trimEnd()}\n\n`).join('') + body

function ContextChip({
  icon: I,
  label,
  detail,
  open,
  remove,
}: {
  icon: typeof FileText | ReactNode
  label: string
  detail?: string
  /** Opens what the chip stands for, such as a pinned file in the file screen. */
  open?: () => void
  /** Absent for a chip that only points at something in the text, such as the tagged file under the cursor. */
  remove?: () => void
}) {
  const { c } = useTheme()
  const say = useSay()
  const content = (
    <>
      {/* Lucide icons are forwardRef objects, not functions: anything that is not already an element is a component. */}
      {isValidElement(I) ? I : I ? <IconOf icon={I as typeof FileText} color={c.accent} /> : null}
      <T size={font.caption + 1} weight="500" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </T>
    </>
  )
  return (
    <View
      accessibilityLabel={open ? undefined : (detail ?? label)}
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
      {open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={say('Open {0}', { '0': detail ?? label })}
          onPress={() => {
            tap()
            open()
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
      {remove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={say('Remove {0}', { '0': label })}
          hitSlop={8}
          onPress={() => {
            tap()
            remove()
          }}
          // A round target inside the round chip, so the press shade follows the pill's shape.
          style={({ pressed }) => ({
            width: 22,
            height: 22,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? c.pressed : 'transparent',
          })}
        >
          <X size={12} color={c.muted} />
        </Pressable>
      ) : (
        <View style={{ width: 6 }} />
      )}
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
  const say = useSay()
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
          label: e || say('Default'),
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
      : (shown?.label ?? say('Custom'))
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
            { key: 'model', label: say('Steps') },
            { key: 'effort', label: say('Effort') },
          ]}
          style={{ width: 150 }}
        />
      </View>
      {mode === 'model' ? (
        // One tap per step: a slider inside a sheet fought the sheet's own drag.
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={say('Model set step')}
          style={{ marginHorizontal: -space.l }}
        >
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
          accessibilityLabel={say('Reasoning effort level')}
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
      {current && (value.provider === 'codex' || choosesSpeed(value.provider, current)) ? (
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
            {say('Fast mode · higher usage')}
          </T>
          <T size={font.control} weight="600" tone={value.settings?.serviceTier === 'fast' ? 'accent' : 'muted'}>
            {value.settings?.serviceTier === 'fast' ? say('On') : say('Off')}
          </T>
        </Pressable>
      ) : null}
    </View>
  )
}

/**
 * While the agent works, holding Send offers both ways to send in the system action sheet, as T3 Code does; a tap still
 * sends the usual way. A menu view wrapped around the button swallowed taps on iOS, so the button itself takes the hold.
 */
function sendChoice(
  enabled: boolean,
  mode: 'queue' | 'steer',
  labels: { queue: string; steer: string; queueHelp: string; steerHelp: string; menu: string; cancel: string },
  onChoose: (mode: 'queue' | 'steer') => void,
): (() => void) | undefined {
  if (!enabled) return undefined
  // The usual way comes first, so the sheet reads the same as the tap.
  const choices = mode === 'steer' ? (['steer', 'queue'] as const) : (['queue', 'steer'] as const)
  const message = choices.map((choice) => `${labels[choice]}: ${labels[`${choice}Help`]}`).join('\n')
  const open = () => {
    tap()
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: labels.menu,
          message,
          options: [...choices.map((choice) => labels[choice]), labels.cancel],
          cancelButtonIndex: 2,
        },
        (index) => {
          const choice = choices[index]
          if (choice) onChoose(choice)
        },
      )
    else
      Alert.alert(labels.menu, message, [
        { text: labels.cancel, style: 'cancel' },
        ...choices.map((choice) => ({ text: labels[choice], onPress: () => onChoose(choice) })),
      ])
  }
  return open
}

function IconOf({ icon: I, color }: { icon: typeof FileText; color: string }) {
  return <I size={12} color={color} />
}

/**
 * Markdown as it is typed, as the desktop's box shows it: every character stays, markers dim, and bold, italic, struck,
 * linked, quoted and code text take their look, so the caret never jumps.
 */
function MarkdownText({ source }: { source: string }) {
  const { c } = useTheme()
  const look = (marks: MarkdownMark[]): TextStyle => ({
    ...(marks.includes('marker') ? { color: c.muted } : null),
    ...(marks.includes('strong') || marks.includes('heading') ? { fontWeight: '600' as const } : null),
    ...(marks.includes('emphasis') ? { fontStyle: 'italic' as const } : null),
    ...(marks.includes('strike') ? { color: c.muted, textDecorationLine: 'line-through' as const } : null),
    ...(marks.includes('quote') ? { color: c.soft } : null),
    ...(marks.includes('link') ? { color: c.accent } : null),
    ...(marks.includes('code')
      ? {
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
          backgroundColor: c.fill,
          fontSize: Math.round(font.body * 0.92),
        }
      : null),
  })
  return (
    <>
      {markdownRuns(source).map((run, index) =>
        run.marks.length ? (
          <Text key={index} style={look(run.marks)}>
            {run.text}
          </Text>
        ) : (
          run.text
        ),
      )}
    </>
  )
}
